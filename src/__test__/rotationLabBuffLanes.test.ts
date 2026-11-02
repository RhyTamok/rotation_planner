import { describe, expect, it } from "vitest";

import { BuffType } from "../Game/Common";
import { buffLanes, laneCoverage } from "../RotationLab/editor/buffLanes";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";

describe("Rotation Lab - party buff lanes", () => {
	const windows = [
		{ buff: BuffType.BattleLitany, time: 60, duration: 20 },
		{ buff: BuffType.TechnicalFinish, time: 7, duration: 20 },
		{ buff: BuffType.BattleLitany, time: 0, duration: 20 },
	];

	it("groups windows into one lane per buff, ordered by first appearance", () => {
		const lanes = buffLanes("VPR", windows);
		expect(lanes.map((l) => l.buff)).toEqual([BuffType.BattleLitany, BuffType.TechnicalFinish]);
		expect(lanes[0].windows.map((w) => w.time)).toEqual([0, 60]);
		expect(lanes[0].icon).toBe("Buffs/DRG/Battle Litany.png");
		expect(lanes[1].icon).toBe("Buffs/DNC/Technical Finish.png");
		expect(lanes[0].color).toMatch(/^#/);
	});

	it("covers action times inside a window, both ends inclusive, marking each window's first row", () => {
		const [litany] = buffLanes("VPR", windows);
		const coverage = laneCoverage(litany, [-1, 0, 10, 20, 20.01, 60, 70, NaN]);
		expect(coverage.map((c) => c !== undefined)).toEqual([
			false,
			true,
			true,
			true,
			false,
			true,
			true,
			false,
		]);
		expect(coverage.map((c) => c?.first)).toEqual([
			undefined,
			true,
			false,
			false,
			undefined,
			true,
			false,
			undefined,
		]);
		expect(coverage[2]!.remaining).toBe(10);
	});

	it("agrees with the simulator on which actions a buff covers", () => {
		const result = simulateRotation(
			{ id: "t", steps: ["REAVING_FANGS", "REAVING_FANGS", "REAVING_FANGS", "STEEL_FANGS"] },
			{
				encounterRules: true,
				config: { fps: 0 },
				partyBuffs: [{ buff: BuffType.BattleLitany, time: 2, duration: 3 }],
			},
		);
		const [lane] = buffLanes("VPR", result.encounter.partyBuffs);
		const covered = laneCoverage(
			lane,
			result.actions.map((a) => a.startTime),
		).map((c) => c !== undefined);
		const unbuffed = simulateRotation(
			{ id: "t", steps: ["REAVING_FANGS", "REAVING_FANGS", "REAVING_FANGS", "STEEL_FANGS"] },
			{ encounterRules: true, config: { fps: 0 } },
		);
		// Battle Litany raises crit, so exactly the covered actions gain potency.
		const buffed = result.actions.map(
			(a, i) =>
				a.appliedPotency + a.pendingPotency >
				unbuffed.actions[i].appliedPotency + unbuffed.actions[i].pendingPotency,
		);
		expect(covered).toEqual(buffed);
		expect(covered).toContain(true);
		expect(covered).toContain(false);
	});
});
