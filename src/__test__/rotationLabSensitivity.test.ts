import { describe, expect, it } from "vitest";

import { CumulativeSeries } from "../RotationLab/comparison/compare";
import {
	competitiveAt,
	intervalAnalysis,
	leaderChanges,
} from "../RotationLab/comparison/competitive";
import { effectiveInterval, localSensitivity } from "../RotationLab/comparison/sensitivity";

function series(hits: [number, number][]): CumulativeSeries {
	let total = 0;
	return {
		metric: "damage",
		times: hits.map(([t]) => t),
		totals: hits.map(([, d]) => (total += d)),
	};
}

describe("Rotation Lab - evaluation intervals", () => {
	it("limits an interval to the fight and says which side moved", () => {
		expect(effectiveInterval(10, 20, 30)).toEqual({
			start: 10,
			end: 20,
			clampedStart: false,
			clampedEnd: false,
		});
		expect(effectiveInterval(-5, 40, 30)).toEqual({
			start: 1,
			end: 30,
			clampedStart: true,
			clampedEnd: true,
		});
	});

	it("gives nothing when no time is left", () => {
		expect(effectiveInterval(20, 10, 30)).toBeUndefined();
		expect(effectiveInterval(40, 50, 30)).toBeUndefined();
		expect(effectiveInterval(10, 20, 0)).toBeUndefined();
	});
});

describe("Rotation Lab - state at one instant", () => {
	const all = { a: series([[10, 1000]]), b: series([[10, 1001]]) };

	it("separates the exact leader from within the threshold", () => {
		const close = competitiveAt(all, ["a", "b"], 20, 0.1);
		expect(close.leaders).toEqual(["b"]);
		expect(close.competitive).toEqual(["a", "b"]);
		// 1 in 1001 is 0.0999%, so a threshold of 0.05% leaves A out.
		expect(competitiveAt(all, ["a", "b"], 20, 0.05).competitive).toEqual(["b"]);
	});

	it("matches the interval analysis at the same instant", () => {
		const { pieces } = intervalAnalysis(all, ["a", "b"], 12, 20, 0.05);
		const first = competitiveAt(all, ["a", "b"], 12, 0.05);
		expect(first.competitive).toEqual(pieces[0].competitive);
		expect(first.leaders).toEqual(pieces[0].leaders);
	});
});

describe("Rotation Lab - exact leader changes", () => {
	it("lists every change of leader, ties included, but not the state at T1", () => {
		const { pieces } = intervalAnalysis(
			{
				a: series([
					[1, 100],
					[3, 100],
					[6, 300],
				]),
				b: series([
					[2, 150],
					[3, 50],
					[4, 200],
				]),
			},
			["a", "b"],
			1,
			8,
			0.1,
		);
		// A leads at 1 s; B passes at 2 s; tied at 3 s (200 each); B at 4 s; A at 6 s.
		expect(leaderChanges(pieces)).toEqual([
			{ time: 2, leaders: ["b"] },
			{ time: 3, leaders: ["a", "b"] },
			{ time: 4, leaders: ["b"] },
			{ time: 6, leaders: ["a"] },
		]);
	});
});

describe("Rotation Lab - local cutoff sensitivity", () => {
	// A is the baseline: 100 at 10 s and at 20 s. B: 200 at 10 s, 100 at 20 s.
	const comparison = {
		baselineId: "a",
		ids: ["a", "b"],
		series: {
			a: series([
				[10, 100],
				[20, 100],
			]),
			b: series([
				[10, 200],
				[20, 100],
			]),
		},
	};

	it("finds the range of deltaDps from both ends of each piece", () => {
		const result = localSensitivity(comparison, 15, 5, 30, 0.1)!;
		expect(result.interval).toEqual({
			start: 10,
			end: 20,
			clampedStart: false,
			clampedEnd: false,
		});
		const b = result.entries[1];
		// The gap of 100 falls from 100/10 to 100/20 over the piece.
		expect(b.highestDeltaDps).toBeCloseTo(10, 9);
		expect(b.lowestDeltaDps).toBeCloseTo(5, 9);
		expect(b.alwaysCompetitive).toBe(true);
		expect(b.maxRegretDps).toBe(0);
		const a = result.entries[0];
		expect([a.lowestDeltaDps, a.highestDeltaDps]).toEqual([0, 0]);
		expect(a.alwaysCompetitive).toBe(false);
		expect(a.maxRegretDps).toBeCloseTo(10, 9);
		expect(a.maxRegretFraction).toBeCloseTo(0.5, 9);
	});

	it("catches a low just before a hit, which sampling after each hit would miss", () => {
		const dip = {
			baselineId: "a",
			ids: ["a", "b"],
			series: {
				a: series([[20, 100]]),
				b: series([
					[10, 100],
					[20, 500],
				]),
			},
		};
		const [, b] = localSensitivity(dip, 20, 10, 40, 0.1)!.entries;
		// B has 100 and A nothing until 20 s, so the gap just before the hits is 100/20 = 5. After
		// them B has 600 and A 100, so it is 500/20 = 25.
		expect(b.lowestDeltaDps).toBeCloseTo(5, 9);
		expect(b.highestDeltaDps).toBeCloseTo(25, 9);
	});

	it("counts a hit landing exactly at the end of the window as not competitive throughout", () => {
		const late = {
			baselineId: "a",
			ids: ["a", "b"],
			series: {
				a: series([[1, 1000]]),
				b: series([
					[1, 1000],
					[20, 500],
				]),
			},
		};
		const [a] = localSensitivity(late, 15, 5, 30, 0.1)!.entries;
		expect(a.alwaysCompetitive).toBe(false);
	});

	it("limits the window to the fight, and never extrapolates past it", () => {
		const clamped = localSensitivity(comparison, 28, 5, 30, 0.1)!;
		expect(clamped.interval).toEqual({
			start: 23,
			end: 30,
			clampedStart: false,
			clampedEnd: true,
		});
		expect(localSensitivity(comparison, 40, 5, 30, 0.1)).toBeUndefined();
	});
});
