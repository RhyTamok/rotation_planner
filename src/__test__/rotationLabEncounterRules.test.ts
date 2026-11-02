import { describe, expect, it } from "vitest";

import { getSkill } from "../Game/Skills";
import { EncounterViolation } from "../RotationLab/rules/encounterRules";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationStep, SimulationOptions } from "../RotationLab/simulation/types";
import { ActionKey } from "../Game/Data";

const RULES: SimulationOptions = { encounterRules: true, end: "settled" };
const delayOf = (action: ActionKey) => getSkill("VPR", action)!.applicationDelay;

function run(steps: (ActionKey | RotationStep)[], options: SimulationOptions = RULES) {
	return simulateRotation({ id: "test", steps }, options);
}

function firstHitTime(steps: (ActionKey | RotationStep)[], options?: SimulationOptions) {
	return run(steps, options).damageEvents.find((e) => !e.isAutoAttack)!.time;
}

describe("pull rule", () => {
	it("holds the opener so its damage lands exactly at 0 s", () => {
		const result = run(["REAVING_FANGS"]);
		const opener = result.actions[0];
		expect(opener.startTime).toBeCloseTo(-delayOf("REAVING_FANGS"), 6);
		expect(opener.pullHold).toBeCloseTo(5 - delayOf("REAVING_FANGS"), 6);
		expect(firstHitTime(["REAVING_FANGS"])).toBeCloseTo(0, 6);
		expect(result.countdownExtension).toBeUndefined();
	});

	it("keeps non-damaging pre-pull actions where they were pressed", () => {
		const result = run(["TINCTURE", "REAVING_FANGS"]);
		expect(result.actions[0].startTime).toBeCloseTo(-5, 6);
		expect(result.actions[0].pullHold).toBeUndefined();
		expect(firstHitTime(["TINCTURE", "REAVING_FANGS"])).toBeCloseTo(0, 6);
	});

	it("lengthens the countdown when the first hit would land after 0 s", () => {
		const steps: RotationStep[] = [
			{ type: "skill", action: "TINCTURE" },
			{ type: "wait", seconds: 10 },
			{ type: "skill", action: "REAVING_FANGS" },
		];
		const result = run(steps);
		expect(firstHitTime(steps)).toBeCloseTo(0, 6);
		// Tincture was pressed at -5 s with a 5 s countdown; the opener then came ~10.7 s later.
		const lateBy = result.actions[1].startTime + delayOf("REAVING_FANGS");
		expect(lateBy).toBeCloseTo(0, 6);
		expect(result.countdownExtension).toBeGreaterThan(5);
		expect(result.actions[0].startTime).toBeCloseTo(-5 - result.countdownExtension!, 6);
	});

	it("is not applied without encounter rules, matching upstream", () => {
		const result = run(["REAVING_FANGS"], { end: "settled" });
		expect(result.actions[0].startTime).toBeCloseTo(-5, 6);
		expect(result.actions[0].pullHold).toBeUndefined();
	});
});

describe("downtime rules", () => {
	const downtime = { ...RULES, downtime: [{ start: 10, end: 20 }] };

	it("rejects actions that need a target while the boss is untargetable", () => {
		const result = run(
			["REAVING_FANGS", { type: "jumpTo", displayTime: 11 }, "STEEL_FANGS", "LEG_SWEEP"],
			downtime,
		);
		const [, fangs, sweep] = result.actions;
		expect(fangs.valid).toBe(false);
		expect(fangs.invalidReasons).toContain(EncounterViolation.NoTarget);
		expect(sweep.invalidReasons).toContain(EncounterViolation.NoTarget);
		expect(result.valid).toBe(false);
	});

	it("allows Vicepit and self buffs in downtime; Vicepit still readies the Dens", () => {
		const result = run(
			["REAVING_FANGS", { type: "jumpTo", displayTime: 11 }, "VICEPIT", "SERPENTS_IRE"],
			downtime,
		);
		const [, vicepit, ire] = result.actions;
		expect(vicepit.valid).toBe(true);
		expect(ire.valid).toBe(true);
		expect(vicepit.resources.timers.map((t) => t.label)).toContain("Twinblade Combo");
	});

	it("ghosts an action pressed before downtime that lands inside it", () => {
		const press = 10 - delayOf("STEEL_FANGS") / 2;
		const result = run(
			[
				"REAVING_FANGS",
				{ type: "jumpTo", displayTime: press },
				"STEEL_FANGS",
				{ type: "jumpTo", displayTime: 20 },
				"STEEL_FANGS",
			],
			downtime,
		);
		// After Reaving Fangs the Steel Fangs button executes the combo's second step.
		const [, ghosted, next] = result.actions;
		expect(ghosted.valid).toBe(true);
		expect(ghosted.appliedPotency).toBe(0);
		const hit = result.damageEvents.find((e) => e.source === ghosted.executedAction);
		expect(hit?.hitTarget).toBe(false);
		// The combo still advanced (its timer has not run out by 20 s), so the next press moves on.
		expect(next.executedAction).not.toBe(ghosted.executedAction);
	});
});

describe("oGCD placement", () => {
	it("delays an action after it first becomes usable", () => {
		const steps: RotationStep[] = [
			{ type: "skill", action: "REAVING_FANGS" },
			{ type: "skill", action: "STEEL_FANGS" },
			{ type: "skill", action: "SERPENTS_IRE" },
		];
		const plain = run(steps).actions[2];
		const delayed = run([...steps.slice(0, 2), { ...steps[2], delay: 0.5 } as RotationStep])
			.actions[2];
		expect(delayed.startTime).toBeCloseTo(plain.startTime + 0.5, 6);
		// Serpent's Ire needs combat: before the pull it waits for the opener to land at 0 s.
		const opener = run([steps[0], { ...steps[2], delay: 0.5 } as RotationStep]).actions[1];
		expect(opener.startTime).toBeCloseTo(0.5, 6);
	});

	it("flags a GCD clipped by a late weave, but not one delayed on purpose", () => {
		const clippedRun = run([
			"REAVING_FANGS",
			{ type: "skill", action: "SERPENTS_IRE", delay: 1.5 },
			"STEEL_FANGS",
		]);
		const clippedGcd = clippedRun.actions[2];
		expect(clippedGcd.clipped).toBe(true);
		expect(clippedGcd.gcdDelay).toBeGreaterThan(0);

		const heldRun = run(["REAVING_FANGS", { type: "wait", seconds: 3 }, "STEEL_FANGS"]);
		expect(heldRun.actions[1].gcdDelay).toBeGreaterThan(0);
		expect(heldRun.actions[1].clipped).toBe(false);

		const cleanRun = run(["REAVING_FANGS", "SERPENTS_IRE", "STEEL_FANGS"]);
		expect(cleanRun.actions[2].gcdDelay).toBeUndefined();
	});
});

describe("resource snapshots", () => {
	it("records gauges for every action and active timers", () => {
		const result = run(["REAVING_FANGS", "SERPENTS_IRE"]);
		const [fangs, ire] = result.actions;
		expect(fangs.resources.gauges.map((g) => g.label)).toEqual([
			"Rattling Coil",
			"Serpent Offerings",
			"Anguine Tribute",
		]);
		const combo = fangs.resources.timers.find((t) => t.label === "Dual Wield Combo");
		expect(combo?.remaining).toBeGreaterThan(29);
		const coilsBefore = fangs.resources.gauges[0].amount;
		expect(ire.resources.gauges[0].amount).toBe(coilsBefore + 1);
	});
});
