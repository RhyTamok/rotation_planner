import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { rotationTestSetup, rotationTestTeardown, makeTestWithConfigFn, applySkill } from "./utils";
import { controller } from "../Controller/Controller";
import { ActionType } from "../Controller/Record";
import { DEFAULT_CONFIG } from "../Game/GameConfig";
import { ActionKey } from "../Game/Data";
import { getNormalizedSkillName } from "../Game/Skills";
import { RotationSimulator, simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationStep } from "../RotationLab/simulation/types";

beforeEach(rotationTestSetup);
afterEach(rotationTestTeardown);

const testWithConfig = makeTestWithConfigFn("VPR");

function countGlobalTimelineElements(): number {
	return (
		controller.timeline.sharedElements.length +
		controller.timeline.slots.reduce((sum, slot) => sum + slot.elements.length, 0)
	);
}

describe("Rotation Lab - simulator basics", () => {
	it("simulates a single Viper action", () => {
		const result = simulateRotation({ id: "single", steps: ["STEEL_FANGS"] });

		expect(result.valid, JSON.stringify(result.errors)).toBe(true);
		expect(result.actions).toHaveLength(1);
		expect(result.actions[0].requestedAction).toBe("STEEL_FANGS");
		expect(result.actions[0].isGCD).toBe(true);
	});

	it("automatically waits a full GCD between GCD actions", () => {
		const result = simulateRotation({
			id: "two-gcds",
			steps: ["STEEL_FANGS", "STEEL_FANGS"],
		});

		expect(result.valid).toBe(true);
		const [first, second] = result.actions;
		// The second press of the Steel Fangs button is auto-replaced by its next combo step.
		expect(second.executedAction).toBe("HUNTERS_STING");
		const gcd = second.startTime - first.startTime;
		expect(gcd).toBeGreaterThan(2);
		expect(gcd).toBeLessThan(2.6);
	});

	it("records invalid actions, rolls their lock, and keeps simulating", () => {
		// Reawaken without Serpent Offerings is not usable.
		const result = simulateRotation({
			id: "invalid",
			steps: ["REAWAKEN", "STEEL_FANGS"],
		});

		expect(result.valid).toBe(false);
		expect(result.actions).toHaveLength(2);
		expect(result.actions[0].valid).toBe(false);
		expect(result.actions[0].invalidReasons.length).toBeGreaterThan(0);
		expect(result.actions[1].valid).toBe(true);
		expect(result.actions[1].startTime).toBeGreaterThan(result.actions[0].startTime);
	});

	it("reports a jump to a time that has already passed", () => {
		const result = simulateRotation({
			id: "bad-jump",
			steps: ["STEEL_FANGS", { type: "jumpTo", displayTime: -10 }],
		});

		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].stepIndex).toBe(1);
	});

	it("respects a common fight cutoff", () => {
		const result = simulateRotation(
			{ id: "cutoff", steps: ["STEEL_FANGS", "STEEL_FANGS", "STEEL_FANGS"] },
			{ end: 10 },
		);

		expect(result.endTime).toBeCloseTo(10, 5);
		for (const event of result.damageEvents) {
			expect(event.time).toBeLessThanOrEqual(10 + 1e-9);
		}
	});
});

describe("Rotation Lab - simulator isolation", () => {
	const rotationA = { id: "A", steps: ["STEEL_FANGS"] as ActionKey[] };
	const rotationB = {
		id: "B",
		steps: ["STEEL_FANGS", "STEEL_FANGS", "STEEL_FANGS"] as ActionKey[],
	};

	it("produces repeatable results", () => {
		expect(simulateRotation(rotationB, { end: "settled" })).toEqual(
			simulateRotation(rotationB, { end: "settled" }),
		);
	});

	it("does not mix results between rotations", () => {
		const a1 = simulateRotation(rotationA, { end: "settled" });
		const b = simulateRotation(rotationB, { end: "settled" });
		const a2 = simulateRotation(rotationA, { end: "settled" });

		expect(a1).toEqual(a2);
		expect(a1.actions).toHaveLength(1);
		expect(b.actions).toHaveLength(3);
	});

	it("gives the same results when two simulations are advanced interleaved", () => {
		const sequential = [rotationA, rotationB].map((r) => simulateRotation(r, { end: 20 }));

		const simA = new RotationSimulator("VPR");
		const simB = new RotationSimulator("VPR");
		const longest = Math.max(rotationA.steps.length, rotationB.steps.length);
		for (let i = 0; i < longest; i++) {
			if (i < rotationB.steps.length) simB.step(rotationB.steps[i]);
			if (i < rotationA.steps.length) simA.step(rotationA.steps[i]);
		}
		simB.finish(20);
		simA.finish(20);

		expect(simA.result("A")).toEqual(sequential[0]);
		expect(simB.result("B")).toEqual(sequential[1]);
	});

	it("does not touch the global controller", () => {
		const elementsBefore = countGlobalTimelineElements();
		const timeBefore = controller.game.time;
		const jobBefore = controller.game.job;

		const result = simulateRotation(rotationB, { end: 30 });

		expect(result.damageEvents.length).toBeGreaterThan(0);
		expect(countGlobalTimelineElements()).toBe(elementsBefore);
		expect(controller.game.time).toBe(timeBefore);
		expect(controller.game.job).toBe(jobBefore);
	});
});

// Runs the same sequence through the real controller and through the simulator, then compares
// every action rather than only totals, so that offsetting errors cannot hide.
function expectParityWithController(
	steps: ActionKey[],
	setup: (resources: { gain(key: Parameters<typeof gainOn>[1], amount: number): void }) => void,
) {
	// Controller side: testWithConfig has already restarted it with {...DEFAULT_CONFIG, job: "VPR"}.
	setup({ gain: (key, amount) => gainOn(controller.game, key, amount) });
	steps.forEach(applySkill);
	controller.step(4);

	const countdown = controller.game.config.countdown;
	const controllerActions = controller.record.actions
		.filter((node) => node.info.type === ActionType.Skill)
		.map((node) => {
			const potency = node.getPotency({
				tincturePotencyMultiplier: 1,
				untargetable: () => false,
				includePartyBuffs: false,
				includeSplash: true,
			});
			return {
				executedAction: node.maybeGetActionKey(),
				startTime: node.tmp_startLockTime! - countdown,
				appliedPotency: potency.applied,
				pendingPotency: potency.snapshottedButPending,
			};
		});

	// Simulator side, using the same config.
	const sim = new RotationSimulator("VPR", { config: { ...DEFAULT_CONFIG, job: "VPR" } });
	setup({ gain: (key, amount) => gainOn(sim.game, key, amount) });
	steps.forEach((s) => sim.step(s));
	sim.step({ type: "wait", seconds: 4 });
	const simActions = sim.result("parity").actions.map((a) => ({
		executedAction: a.executedAction,
		startTime: a.startTime,
		appliedPotency: a.appliedPotency,
		pendingPotency: a.pendingPotency,
	}));

	expect(simActions).toHaveLength(controllerActions.length);
	simActions.forEach((actual, i) => {
		const expected = controllerActions[i];
		expect(actual.executedAction, `action ${i}`).toBe(expected.executedAction);
		expect(actual.startTime, `action ${i} start`).toBeCloseTo(expected.startTime, 6);
		expect(actual.appliedPotency, `action ${i} potency`).toBeCloseTo(
			expected.appliedPotency,
			6,
		);
		expect(actual.pendingPotency, `action ${i} pending`).toBeCloseTo(
			expected.pendingPotency,
			6,
		);
	});
}

function gainOn(
	game: typeof controller.game,
	key: "SERPENT_OFFERINGS" | "RATTLING_COIL",
	amount: number,
) {
	game.resources.get(key).gain(amount);
}

describe("Rotation Lab - parity with the XIV in the Shell controller", () => {
	it(
		"matches the auto-replaced single-target filler combo",
		testWithConfig({}, () => {
			expectParityWithController(
				[
					"STEEL_FANGS",
					"REAVING_FANGS",
					"STEEL_FANGS",
					"REAVING_FANGS",
					"STEEL_FANGS",
					"REAVING_FANGS",
				],
				({ gain }) => gain("RATTLING_COIL", 1),
			);
		}),
	);

	it(
		"matches Reawaken with ranged filler and coil",
		testWithConfig({}, () => {
			expectParityWithController(
				[
					"REAWAKEN",
					"FIRST_GENERATION",
					"WRITHING_SNAP",
					"UNCOILED_FURY",
					"SECOND_GENERATION",
				],
				({ gain }) => {
					gain("SERPENT_OFFERINGS", 50);
					gain("RATTLING_COIL", 1);
				},
			);
		}),
	);

	it(
		"matches buffed oGCD weaving after Uncoiled Fury",
		testWithConfig({}, () => {
			expectParityWithController(["UNCOILED_FURY", "TWINFANG", "TWINBLOOD"], ({ gain }) =>
				gain("RATTLING_COIL", 1),
			);
		}),
	);

	it(
		"matches a full Reawaken into Ouroboros",
		testWithConfig({}, () => {
			expectParityWithController(
				[
					"REAWAKEN",
					"FIRST_GENERATION",
					"SERPENTS_TAIL",
					"SECOND_GENERATION",
					"SERPENTS_TAIL",
					"THIRD_GENERATION",
					"SERPENTS_TAIL",
					"FOURTH_GENERATION",
					"SERPENTS_TAIL",
					"OUROBOROS",
				],
				({ gain }) => gain("SERPENT_OFFERINGS", 50),
			);
		}),
	);
});

describe("Rotation Lab - level 100 opener regression", () => {
	// Same timeline file and expected numbers as the upstream "fits expected gcds in pot in
	// opener" test in VprRotations.test.ts, which reports raw times (display time + 5).
	it("reproduces the upstream opener totals", () => {
		const content = JSON.parse(
			fs.readFileSync("src/__test__/Asset/vpr_100_opener.txt", "utf8"),
		);
		const steps: RotationStep[] = content.actions.map(
			(a: {
				type: string;
				skillName?: string;
				waitDuration?: number;
				targetTime?: number;
			}) => {
				if (a.type === "Skill") {
					const action = getNormalizedSkillName(a.skillName!);
					expect(action, a.skillName).toBeDefined();
					return { type: "skill", action: action! };
				} else if (a.type === "Wait") {
					return { type: "wait", seconds: a.waitDuration! };
				} else if (a.type === "JumpToTimestamp") {
					return { type: "jumpTo", displayTime: a.targetTime! };
				}
				throw new Error(`unsupported step type in opener: ${a.type}`);
			},
		);

		const result = simulateRotation(
			{ id: "opener", steps },
			{ config: content.config, tincturePotencyMultiplier: 1.08 },
		);

		expect(result.valid, JSON.stringify(result.errors)).toBe(true);
		expect(result.endTime).toBeCloseTo(42.01667, 2);
		expect(result.totals.gcdCount).toBe(18);
		expect(result.totals.appliedPotencyWithoutPot).toBeCloseTo(18316, 2);
		expect(result.totals.appliedPotency).toBeCloseTo(19494.32, 2);
		expect(result.totals.pendingPotency).toBeCloseTo(187.0, 2);
	});
});
