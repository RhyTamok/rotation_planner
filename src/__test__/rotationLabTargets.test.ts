import { describe, expect, it } from "vitest";

import { BuffType } from "../Game/Common";
import { ActionKey } from "../Game/Data";
import { createRotation } from "../RotationLab/models/Rotation";
import { createScenario } from "../RotationLab/models/Scenario";
import {
	effectiveRanges,
	enemiesAt,
	enemiesThroughout,
	targetRangeProblems,
} from "../RotationLab/rules/targets";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { simulateDocument } from "../RotationLab/simulation/SimulationManager";
import {
	PartyBuffWindow,
	RotationStep,
	SimulatedAction,
	TargetRange,
} from "../RotationLab/simulation/types";

// Targets: handoff section 6. Falloff values come from the engine's skill data (Game/Jobs/VPR.ts).

const range = (start: number, end: number, enemies: number): TargetRange => ({
	start,
	end,
	enemies,
});

describe("Rotation Lab - target ranges", () => {
	it("counts the main target outside every range, and the start but not the end inside", () => {
		const ranges = effectiveRanges([range(10, 20, 3)]);
		expect(enemiesAt(ranges, 9.99)).toBe(1);
		expect(enemiesAt(ranges, 10)).toBe(3);
		expect(enemiesAt(ranges, 19.99)).toBe(3);
		expect(enemiesAt(ranges, 20)).toBe(1);
	});

	it("allows touching ranges", () => {
		const ranges = effectiveRanges([range(10, 20, 3), range(20, 30, 2)]);
		expect(enemiesAt(ranges, 20)).toBe(2);
		expect(targetRangeProblems([range(10, 20, 3), range(20, 30, 2)])).toEqual([
			undefined,
			undefined,
		]);
	});

	it("takes the lowest count from press to damage application", () => {
		const ranges = effectiveRanges([range(10, 20, 3), range(21, 30, 4)]);
		// Adds arriving after the press were never targeted.
		expect(enemiesThroughout(ranges, 9.6, 10.4)).toBe(1);
		// Adds leaving before the damage lands are not hit.
		expect(enemiesThroughout(ranges, 19.6, 20.4)).toBe(1);
		// Present the whole time.
		expect(enemiesThroughout(ranges, 12, 13)).toBe(3);
		// A gap between two ranges counts, even if both ends are inside a range.
		expect(enemiesThroughout(ranges, 19.5, 21.5)).toBe(1);
		// From 3 to 4 enemies: only 3 were there at the press.
		expect(enemiesThroughout(effectiveRanges([range(0, 5, 3), range(5, 9, 4)]), 4, 6)).toBe(3);
	});

	it("reports overlapping and empty ranges per row, and resolves them for the simulation", () => {
		const ranges = [range(10, 20, 3), range(15, 25, 5), range(30, 30, 2)];
		const problems = targetRangeProblems(ranges);
		expect(problems[0]).toContain("Overlaps row 2");
		expect(problems[1]).toContain("Overlaps row 1");
		expect(problems[2]).toContain("End must be after start");
		// The range that starts first wins the overlap; the empty one is ignored.
		expect(effectiveRanges(ranges)).toEqual([range(10, 20, 3), range(20, 25, 5)]);
	});
});

const BASE = { config: { fps: 0 } };

function simulate(
	steps: (ActionKey | RotationStep)[],
	options: { targets?: TargetRange[]; partyBuffs?: PartyBuffWindow[] } = {},
	overrides: { type: string; stacks: number }[] = [],
) {
	return simulateRotation(
		{ id: "t", steps },
		{
			...options,
			config: {
				...BASE.config,
				initialResourceOverrides: overrides.map((o) => ({
					...o,
					timeTillFullOrDrop: 0,
					effectOrTimerEnabled: true,
				})) as never,
			},
			end: "settled",
		},
	);
}

const action = (actions: SimulatedAction[], key: ActionKey) =>
	actions.find((a) => a.executedAction === key)!;

// Every multi-target case presses at 10 s.
const AT_10: RotationStep = { type: "jumpTo", displayTime: 10 };
const WHOLE_FIGHT = [range(-100, 1000, 3)];

describe("Rotation Lab - multi-target damage", () => {
	it("applies the engine's AoE falloff to every enemy hit", () => {
		// Steel Maw has no falloff: three enemies take the full potency.
		const single = action(simulate([AT_10, "STEEL_MAW"]).actions, "STEEL_MAW");
		const three = action(
			simulate([AT_10, "STEEL_MAW"], { targets: WHOLE_FIGHT }).actions,
			"STEEL_MAW",
		);
		expect(single.targetsHit).toBe(1);
		expect(three.targetsHit).toBe(3);
		expect(three.appliedPotency).toBeCloseTo(3 * single.appliedPotency, 6);
		expect(three.expectedDamage!).toBeCloseTo(3 * single.expectedDamage!, 6);

		// Reawaken has a 75% falloff: each secondary target takes 25%.
		const offerings = [{ type: "SERPENT_OFFERINGS", stacks: 50 }];
		const reawaken = (targets?: TargetRange[]) =>
			action(simulate([AT_10, "REAWAKEN"], { targets }, offerings).actions, "REAWAKEN");
		expect(reawaken(WHOLE_FIGHT).appliedPotency).toBeCloseTo(
			1.5 * reawaken().appliedPotency,
			6,
		);
		const twoEnemies = reawaken([range(-100, 1000, 2)]);
		expect(twoEnemies.targetsHit).toBe(2);
		expect(twoEnemies.appliedPotency).toBeCloseTo(1.25 * reawaken().appliedPotency, 6);
	});

	it("never hits more than one enemy with a single-target action", () => {
		const single = action(simulate([AT_10, "STEEL_FANGS"]).actions, "STEEL_FANGS");
		const inRange = action(
			simulate([AT_10, "STEEL_FANGS"], { targets: WHOLE_FIGHT }).actions,
			"STEEL_FANGS",
		);
		expect(inRange.targetsHit).toBe(1);
		expect(inRange.appliedPotency).toBeCloseTo(single.appliedPotency, 6);
	});

	it("applies boss debuffs to the main target only, other party buffs to every target", () => {
		const maw = (buff?: BuffType, targets = WHOLE_FIGHT) =>
			action(
				simulate([AT_10, "STEEL_MAW"], {
					targets,
					partyBuffs: buff ? [{ buff, time: 0, duration: 30 }] : [],
				}).actions,
				"STEEL_MAW",
			).appliedPotency;
		const plain = maw();
		// Dokumori: 5% on one of three enemies.
		expect(maw(BuffType.Dokumori)).toBeCloseTo(plain * ((1.05 + 2) / 3), 6);
		// Brotherhood is a buff on the player: 5% on all three.
		expect(maw(BuffType.Brotherhood)).toBeCloseTo(plain * 1.05, 6);
		// On a single target the debuff applies as before.
		expect(maw(BuffType.Dokumori, [])).toBeCloseTo(maw(undefined, []) * 1.05, 6);
	});

	it("only hits the enemies present from the press until the damage lands", () => {
		// Steel Maw pressed at 10 s lands 1.091 s later.
		const hits = (targets: TargetRange[]) =>
			action(simulate([AT_10, "STEEL_MAW"], { targets }).actions, "STEEL_MAW").targetsHit;
		expect(hits([range(9, 12, 3)])).toBe(3);
		// Arrived after the press: no damage event was ever queued for them.
		expect(hits([range(10.4, 20, 3)])).toBe(1);
		// Left before the damage landed.
		expect(hits([range(5, 10.5, 3)])).toBe(1);
		// Resources still come from the press (the combo continues either way).
		const result = simulate([AT_10, "STEEL_MAW", "STEEL_MAW"], {
			targets: [range(10.4, 20, 3)],
		});
		expect(result.actions.map((a) => a.executedAction)).toEqual(["STEEL_MAW", "HUNTERS_BITE"]);
		expect(result.actions.every((a) => a.valid)).toBe(true);
		// The second press is inside the range from press to landing.
		expect(result.actions[1].targetsHit).toBe(3);
	});

	it("simulates a rotation document with its own target ranges", () => {
		const scenario = createScenario({ name: "s", end: "settled", stats: { fps: 0 } });
		const steps: RotationStep[] = [AT_10, { type: "skill", action: "STEEL_MAW" }];
		const plain = simulateDocument(createRotation({ name: "a", job: "VPR", steps }), scenario);
		const adds = simulateDocument(
			createRotation({ name: "b", job: "VPR", steps, targets: WHOLE_FIGHT }),
			scenario,
		);
		const maw = (r: typeof plain) => action(r.result.actions, "STEEL_MAW");
		expect(maw(plain).targetsHit).toBe(1);
		expect(maw(adds).targetsHit).toBe(3);
		expect(adds.result.damage!.expectedDamage).toBeGreaterThan(
			plain.result.damage!.expectedDamage,
		);
	});
});
