import { describe, expect, it } from "vitest";

import { BuffType } from "../Game/Common";
import {
	burstWindows,
	compareRotations,
	cumulativeSeries,
	dpsAt,
	dpsSamples,
	gaugesAt,
	leadChanges,
	sampleTimes,
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
		actions: [],
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

	// Changed on purpose by comparison milestone M0 (spec Q1). This test used to pin both ends as
	// inclusive and expected 1110; the hit exactly at `start` now belongs to the previous window.
	it("sums hits inside a window as (start, end]", () => {
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
		expect(totalBetween(series, 5, 10)).toBe(1100);
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

	it("samples running DPS at whole seconds from the pull", () => {
		expect(sampleTimes(0, 3.5)).toEqual([1, 2, 3]);
		expect(sampleTimes(1.5, 4)).toEqual([2, 3, 4]);
		const series = cumulativeSeries(
			fakeResult([
				[0, 100],
				[2, 300],
			]),
			"damage",
		);
		expect(dpsSamples(series, [1, 2, 4])).toEqual([100, 200, 100]);
	});

	it("uses custom burst windows when given", () => {
		const comparison = compareRotations(
			fakeResult([[5, 100]], [{ time: 0, duration: 2 }]),
			fakeResult([[5, 40]]),
			[],
			[{ start: 4, end: 6, label: "Opener" }],
		);
		expect(comparison.windows).toEqual([{ start: 4, end: 6, label: "Opener", a: 100, b: 40 }]);
	});

	it("reports each rotation's gauges as of a cutoff", () => {
		const result = simulateRotation(
			{ id: "g", steps: ["REAVING_FANGS", "SERPENTS_IRE", "STEEL_FANGS"] },
			{ encounterRules: true, config: { fps: 0 }, end: "settled" },
		);
		const [, ire, fangs] = result.actions;
		expect(gaugesAt(result, -10)).toBeUndefined();
		// Between Serpent's Ire and the next GCD, the gauges are those after Serpent's Ire.
		expect(gaugesAt(result, (ire.startTime + fangs.startTime) / 2)).toBe(ire.resources.gauges);
		expect(gaugesAt(result, 1000)).toBe(result.actions[2].resources.gauges);
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

// Comparison milestone M0: the cutoff and window rules of spec 2.2, made executable.
describe("Rotation Lab - cutoff and window boundaries", () => {
	const simulate = () =>
		simulateRotation(
			{ id: "boundaries", steps: ["STEEL_FANGS", "REAVING_FANGS", "STEEL_FANGS"] },
			{ encounterRules: true, config: { fps: 0 }, end: "settled" },
		);

	it("counts a hit landing exactly at a cutoff, but not one landing 1 ms later", () => {
		const series = cumulativeSeries(
			fakeResult([
				[10, 100],
				[10.001, 50],
			]),
			"damage",
		);
		expect(totalAt(series, 10)).toBe(100);
		expect(dpsAt(series, 10)).toBe(10);
		expect(totalAt(series, 10.001)).toBe(150);
	});

	it("applies the same cutoff boundary to a simulated hit", () => {
		const result = simulate();
		const hit = result.damageEvents.filter((e) => !e.isAutoAttack).at(-1)!;
		const series = cumulativeSeries(result, "damage");

		expect(hit.expectedDamage).toBeGreaterThan(0);
		expect(totalAt(series, hit.time) - totalAt(series, hit.time - 0.001)).toBeCloseTo(
			hit.expectedDamage!,
			6,
		);
	});

	it("gives a hit on a shared boundary to the window ending there, never to both", () => {
		const series = cumulativeSeries(
			fakeResult([
				[5, 1],
				[10, 10],
				[15, 100],
			]),
			"damage",
		);
		expect(totalBetween(series, 0, 5)).toBe(1);
		expect(totalBetween(series, 5, 10)).toBe(10);
		expect(totalBetween(series, 10, 15)).toBe(100);
		expect(totalBetween(series, 0, 15)).toBe(totalAt(series, 15));
		expect(totalBetween(series, 10, 10)).toBe(0);
	});

	it("uses the same window boundary in the comparison's burst table", () => {
		const hits: [number, number][] = [
			[5, 1],
			[10, 10],
			[15, 100],
		];
		const comparison = compareRotations(
			fakeResult(hits),
			fakeResult(hits),
			[],
			[
				{ start: 5, end: 10 },
				{ start: 10, end: 15 },
			],
		);
		expect(comparison.windows.map((w) => w.a)).toEqual([10, 100]);
	});

	// Decided by the user after M0: the pull hit has no earlier window, so it belongs to the window
	// starting at 0 s. Measured pull hits are exactly 0 or within 3.6e-15 s of it, either way.
	it.each([0, 8.881784197001252e-16, -3.552713678800501e-15])(
		"gives a pull hit at %d s to the window starting at 0 s, not the one ending there",
		(pull) => {
			const series = cumulativeSeries(
				fakeResult([
					[-2, 5],
					[pull, 50],
					[1, 10],
				]),
				"damage",
			);
			expect(totalBetween(series, 0, 1)).toBe(60);
			expect(totalBetween(series, -5, 0)).toBe(5);
			expect(totalBetween(series, -5, 1)).toBe(65);
			// A cutoff at the pull still counts it.
			expect(totalAt(series, 0)).toBe(55);
		},
	);

	it("includes a simulated pull hit in a window starting at 0 s", () => {
		const result = simulate();
		const pullHit = result.damageEvents.find((e) => !e.isAutoAttack)!;
		const series = cumulativeSeries(result, "damage");

		expect(Math.abs(pullHit.time)).toBeLessThan(1e-9);
		// A narrow window: the first auto-attack lands within the first second.
		expect(totalBetween(series, 0, 0.001)).toBeCloseTo(pullHit.expectedDamage!, 6);
	});

	// A hit due at 7.5 s is recorded at 7.500000000000002 s by the real engine.
	it("counts a hit within float noise of a typed cutoff, on either side", () => {
		const late = cumulativeSeries(fakeResult([[7.500000000000002, 100]]), "damage");
		const early = cumulativeSeries(fakeResult([[7.499999999999998, 100]]), "damage");
		expect(totalAt(late, 7.5)).toBe(100);
		expect(totalAt(early, 7.5)).toBe(100);
		expect(dpsAt(late, 7.5)).toBeCloseTo(100 / 7.5, 6);
	});

	it("gives a hit within float noise of a shared boundary to one window only", () => {
		const series = cumulativeSeries(fakeResult([[10.000000000000002, 100]]), "damage");
		expect(totalBetween(series, 5, 10)).toBe(100);
		expect(totalBetween(series, 10, 15)).toBe(0);
	});

	it("reports no lead when float noise is all that separates two hits", () => {
		const a = cumulativeSeries(fakeResult([[7.5, 100]]), "damage");
		const b = cumulativeSeries(fakeResult([[7.500000000000002, 100]]), "damage");
		expect(leadChanges(a, b)).toEqual([]);
	});

	it("reads gauges within float noise of a press as after that press", () => {
		const result = simulate();
		const [first, second] = result.actions;
		expect(gaugesAt(result, second.startTime - 1e-12)).toBe(second.resources.gauges);
		expect(gaugesAt(result, second.startTime - 0.001)).toBe(first.resources.gauges);
	});

	it.todo("adds nothing to a cutoff for DoT ticks landing after it (needs Dragoon)");
});
