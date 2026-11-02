import { describe, expect, it } from "vitest";

import { BuffType } from "../Game/Common";
import {
	burstWindows,
	compareRotations,
	cumulativeSeries,
	dpsAt,
	leadChanges,
	totalAt,
	totalBetween,
} from "../RotationLab/comparison/compare";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationResult } from "../RotationLab/simulation/types";

// A result with just the fields the comparison reads.
function fakeResult(
	hits: [time: number, damage: number, hitTarget?: boolean][],
	partyBuffs: { time: number; duration: number }[] = [],
): RotationResult {
	return {
		damage: { expectedDamage: 0, autoAttackDamage: 0, pendingDamage: 0 },
		damageEvents: hits.map(([time, damage, hitTarget = true]) => ({
			time,
			source: "STEEL_FANGS",
			potency: damage / 10,
			expectedDamage: damage,
			isAutoAttack: false,
			hitTarget,
		})),
		encounter: {
			partyBuffs: partyBuffs.map((w) => ({ buff: BuffType.BattleLitany, ...w })),
			downtime: [],
		},
	} as unknown as RotationResult;
}

describe("Rotation Lab - comparison maths", () => {
	it("accumulates landed hits in time order, merging simultaneous hits", () => {
		const series = cumulativeSeries(
			fakeResult([
				[2, 100],
				[0, 50],
				[2, 25],
				[3, 999, false],
			]),
			"damage",
		);
		expect(series.times).toEqual([0, 2]);
		expect(series.totals).toEqual([50, 175]);
		expect(totalAt(series, -1)).toBe(0);
		expect(totalAt(series, 0)).toBe(50);
		expect(totalAt(series, 1.99)).toBe(50);
		expect(totalAt(series, 2)).toBe(175);
		expect(totalAt(series, 100)).toBe(175);
	});

	it("uses potency when asked, and DPS from the pull", () => {
		const series = cumulativeSeries(fakeResult([[1, 100]]), "potency");
		expect(totalAt(series, 1)).toBe(10);
		expect(dpsAt(series, 4)).toBe(2.5);
		expect(dpsAt(series, 0)).toBeUndefined();
	});

	it("sums hits inside a window, both ends inclusive", () => {
		const series = cumulativeSeries(
			fakeResult([
				[0, 1],
				[5, 10],
				[7, 100],
				[10, 1000],
				[11, 10000],
			]),
			"damage",
		);
		expect(totalBetween(series, 5, 10)).toBe(1110);
		expect(totalBetween(series, 5.5, 9)).toBe(100);
	});

	it("finds lead changes, ignoring ties", () => {
		const a = cumulativeSeries(
			fakeResult([
				[1, 100],
				[3, 100],
				[6, 300],
			]),
			"damage",
		);
		const b = cumulativeSeries(
			fakeResult([
				[2, 150],
				[3, 50],
				[4, 200],
			]),
			"damage",
		);
		// A leads at 1 s; B passes at 2 s; tied at 3 s (200 each) and still B from 4 s; A at 6 s.
		expect(leadChanges(a, b)).toEqual([
			{ time: 1, leader: "a" },
			{ time: 2, leader: "b" },
			{ time: 6, leader: "a" },
		]);
	});

	it("merges overlapping buff windows into burst windows", () => {
		const result = fakeResult(
			[],
			[
				{ time: 120, duration: 20 },
				{ time: 0, duration: 20 },
				{ time: 7, duration: 20 },
				{ time: 27, duration: 5 },
			],
		);
		expect(burstWindows(result)).toEqual([
			{ start: 0, end: 32 },
			{ start: 120, end: 140 },
		]);
	});

	it("compares two results at cutoffs and in burst windows", () => {
		const buffs = [{ time: 0, duration: 10 }];
		const comparison = compareRotations(
			fakeResult(
				[
					[1, 100],
					[20, 100],
				],
				buffs,
			),
			fakeResult(
				[
					[1, 50],
					[20, 200],
				],
				buffs,
			),
			[10, 20],
		);
		expect(comparison.metric).toBe("damage");
		expect(comparison.cutoffs).toEqual([
			{ time: 10, a: 100, b: 50, dpsA: 10, dpsB: 5 },
			{ time: 20, a: 200, b: 250, dpsA: 10, dpsB: 12.5 },
		]);
		expect(comparison.windows).toEqual([{ start: 0, end: 10, a: 100, b: 50 }]);
		expect(comparison.leadChanges.map((c) => c.leader)).toEqual(["a", "b"]);
	});

	it("matches the simulator's own totals for a real rotation", () => {
		const result = simulateRotation(
			{
				id: "real",
				steps: ["REAVING_FANGS", "REAVING_FANGS", "REAVING_FANGS", "SERPENTS_IRE"],
			},
			{ encounterRules: true, config: { fps: 0 }, end: "settled" },
		);
		const series = cumulativeSeries(result, "damage");
		expect(totalAt(series, result.endTime)).toBeCloseTo(result.damage!.expectedDamage, 6);
		expect(dpsAt(series, result.endTime)).toBeCloseTo(result.damage!.expectedDps!, 6);
	});
});
