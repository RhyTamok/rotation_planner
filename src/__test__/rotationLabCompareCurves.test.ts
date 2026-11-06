import { describe, expect, it } from "vitest";

import {
	deltaDpsSeries,
	deltaPctSeries,
	SeriesComparison,
} from "../RotationLab/comparison/baseline";
import { burstTable } from "../RotationLab/comparison/burst";
import { CumulativeSeries } from "../RotationLab/comparison/compare";
import {
	CurvePoint,
	deltaDpsCurve,
	deltaPctCurve,
	runningDpsCurve,
} from "../RotationLab/comparison/curves";
import {
	defaultCutoffs,
	isListedCutoff,
	listedCutoffs,
	reportedCutoffs,
	withCutoff,
	withoutCutoff,
} from "../RotationLab/comparison/cutoffs";

// Totals after each hit, from [time, damage] pairs.
function series(hits: [number, number][]): CumulativeSeries {
	let total = 0;
	return {
		metric: "damage",
		times: hits.map(([t]) => t),
		totals: hits.map(([, d]) => (total += d)),
	};
}

const valuesAt = (points: CurvePoint[], t: number) =>
	points.filter((p) => p.t === t).map((p) => p.value);

describe("Rotation Lab - default cutoffs (spec Q7)", () => {
	it("lists every 30 s, stopping short of the end of the fight", () => {
		expect(defaultCutoffs(100)).toEqual([30, 60, 90]);
		expect(defaultCutoffs(90)).toEqual([30, 60]);
		expect(defaultCutoffs(20)).toEqual([]);
		expect(defaultCutoffs(0)).toEqual([]);
	});

	it("uses the stored list when there is one", () => {
		expect(listedCutoffs([], 70)).toEqual([30, 60]);
		expect(listedCutoffs([45], 70)).toEqual([45]);
	});

	it("adds the end of the fight once, in order, despite float noise", () => {
		expect(reportedCutoffs([60, 30], 70)).toEqual([30, 60, 70]);
		expect(reportedCutoffs([30, 90], 90.0000000002)).toEqual([30, 90]);
		expect(defaultCutoffs(90.0000000002)).toEqual([30, 60]);
		// A cutoff past the end is still reported (decision C5).
		expect(reportedCutoffs([100], 70)).toEqual([70, 100]);
	});

	it("edits the list without doubling an instant", () => {
		expect(withCutoff([30], 60)).toEqual([30, 60]);
		expect(withCutoff([30], 30.0000001)).toEqual([30]);
		expect(withoutCutoff([30, 60], 30.0000001)).toEqual([60]);
		expect(isListedCutoff([30], 30.0000001)).toBe(true);
		expect(isListedCutoff([30], 31)).toBe(false);
	});
});

describe("Rotation Lab - chart curves", () => {
	// A lands 100 at 10 s; the baseline B lands 100 at 20 s.
	const comparison: SeriesComparison = {
		baselineId: "b",
		ids: ["a", "b"],
		series: {
			a: series([[10, 100]]),
			b: series([[20, 100]]),
		},
	};

	it("gives deltaDps before and after each jump, not only after", () => {
		const points = deltaDpsCurve(comparison, "a", 5, 40);
		expect(points[0]).toEqual({ t: 5, value: 0 });
		expect(valuesAt(points, 10)).toEqual([0, 10]);
		// Between hits the gap follows c / t: 100 / 20, before B's hit closes it.
		expect(valuesAt(points, 20)).toEqual([5, 0]);
		expect(points[points.length - 1]).toEqual({ t: 40, value: 0 });
	});

	it("follows c / t across a long gap instead of a straight line", () => {
		const points = runningDpsCurve(series([[2, 100]]), 2, 102);
		// The step is 1/200 of the 100 s shown.
		expect(points.length).toBeGreaterThan(200);
		const midway = points.find((p) => p.t === 52)!;
		expect(midway.value).toBeCloseTo(100 / 52, 9);
		// A straight line from 50 DPS to 0.98 DPS would pass 25.5 here.
		expect(midway.value).toBeLessThan(2);
	});

	it("holds deltaPct still between hits, with gaps while the baseline total is 0", () => {
		const points = deltaPctCurve(comparison, "a", 5, 40);
		expect(valuesAt(points, 5)).toEqual([undefined]);
		expect(valuesAt(points, 20)).toEqual([undefined, 0]);
		const after = points.filter((p) => p.t > 20);
		expect(new Set(after.map((p) => p.value))).toEqual(new Set([0]));
	});

	it("agrees with the sampled series at every event, after the jump", () => {
		const threeHits: SeriesComparison = {
			baselineId: "b",
			ids: ["a", "b"],
			series: {
				a: series([
					[3, 300],
					[7.5, 100],
					[14, 700],
				]),
				b: series([
					[4, 200],
					[7.5, 250],
					[11, 90],
				]),
			},
		};
		const dps = deltaDpsCurve(threeHits, "a", 1, 20);
		const sampledDps = deltaDpsSeries(threeHits, [20]);
		sampledDps.times.forEach((t, i) => {
			expect(valuesAt(dps, t).at(-1)).toBeCloseTo(sampledDps.series[0].deltaDps[i], 9);
		});
		const pct = deltaPctCurve(threeHits, "a", 1, 20);
		const sampledPct = deltaPctSeries(threeHits, [20]);
		sampledPct.times.forEach((t, i) => {
			const sampled = sampledPct.series[0].deltaPct[i];
			const value = valuesAt(pct, t).at(-1);
			// No percentage until the baseline's first hit, in both.
			if (sampled === undefined) expect(value).toBeUndefined();
			else expect(value).toBeCloseTo(sampled, 9);
		});
	});

	it("counts a hit landing exactly at the end, and starts no earlier than 1 s", () => {
		const points = runningDpsCurve(
			series([
				[0, 10],
				[10, 90],
			]),
			0,
			10,
		);
		expect(points[0]).toEqual({ t: 1, value: 10 });
		expect(valuesAt(points, 10)).toEqual([1, 10]);
	});

	it("has nothing to draw when the start is past the end", () => {
		expect(runningDpsCurve(series([[1, 1]]), 50, 40)).toEqual([]);
	});
});

describe("Rotation Lab - burst table", () => {
	it("gives each window's total per configuration against the baseline", () => {
		const windows = burstTable(
			{
				baselineId: "a",
				ids: ["a", "b", "c"],
				series: {
					a: series([
						[5, 1],
						[10, 10],
						[15, 100],
					]),
					b: series([
						[5, 2],
						[12, 40],
					]),
					c: series([]),
				},
			},
			[
				{ start: 5, end: 10, label: "First" },
				{ start: 10, end: 15 },
			],
		);
		expect(windows).toEqual([
			{
				start: 5,
				end: 10,
				label: "First",
				rows: [
					{ id: "a", total: 10, deltaTotal: 0 },
					{ id: "b", total: 0, deltaTotal: -10 },
					{ id: "c", total: 0, deltaTotal: -10 },
				],
			},
			{
				start: 10,
				end: 15,
				rows: [
					{ id: "a", total: 100, deltaTotal: 0 },
					{ id: "b", total: 40, deltaTotal: -60 },
					{ id: "c", total: 0, deltaTotal: -100 },
				],
			},
		]);
	});
});
