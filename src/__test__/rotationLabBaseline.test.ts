import { describe, expect, it } from "vitest";

import {
	compareConfigurations,
	deltaDpsSeries,
	deltaPctSeries,
} from "../RotationLab/comparison/baseline";
import { cumulativeSeries, dpsAt } from "../RotationLab/comparison/compare";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationResult } from "../RotationLab/simulation/types";

// N-way baseline maths (comparison roadmap M2; spec 2.2). Fixtures are hand-computed.

type Hits = [time: number, damage: number][];

function fakeResult(hits: Hits): RotationResult {
	return {
		actions: [],
		damage: { expectedDamage: 0, autoAttackDamage: 0, pendingDamage: 0 },
		damageEvents: hits.map(([time, damage]) => ({
			time,
			source: "STEEL_FANGS",
			potency: damage / 10,
			expectedDamage: damage,
			isAutoAttack: false,
			hitTarget: true,
		})),
		encounter: { partyBuffs: [], downtime: [] },
	} as unknown as RotationResult;
}

// Totals at 10 s: A 1000, B 800, C 600, D 800. At 20 s: A 1200, B 1800, C 1000, D 800.
const A: Hits = [
	[5, 1000],
	[15, 200],
];
const B: Hits = [
	[5, 800],
	[15, 1000],
];
const C: Hits = [
	[10, 600],
	[20, 400],
];
const D: Hits = [[10, 800]];
const configs = (...which: [string, Hits][]) =>
	which.map(([id, hits]) => ({ id, result: fakeResult(hits) }));

describe("Rotation Lab - baseline-relative comparison", () => {
	it("computes DPS, delta, percent and rank for two configurations", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B]), "a", [10, 20]);
		const [at10, at20] = cmp.cutoffs;
		expect(at10.rows).toEqual([
			{ id: "a", total: 1000, dps: 100, deltaDps: 0, deltaPct: 0, rank: 1 },
			{ id: "b", total: 800, dps: 80, deltaDps: -20, deltaPct: -0.2, rank: 2 },
		]);
		expect(at20.rows[0]).toMatchObject({ dps: 60, deltaDps: 0, rank: 2 });
		expect(at20.rows[1]).toMatchObject({ dps: 90, deltaDps: 30, deltaPct: 0.5, rank: 1 });
	});

	it("handles three and four configurations, with ties sharing a rank", () => {
		const three = compareConfigurations(configs(["a", A], ["b", B], ["c", C]), "b", [10]);
		expect(three.cutoffs[0].rows.map((r) => [r.id, r.rank, r.deltaDps])).toEqual([
			["a", 1, 20],
			["b", 2, 0],
			["c", 3, -20],
		]);
		// At 10 s: B and D are both 80 DPS (rank 2), C is 60 (rank 4).
		const four = compareConfigurations(configs(["a", A], ["b", B], ["c", C], ["d", D]), "a", [
			10,
		]);
		expect(four.cutoffs[0].rows.map((r) => r.rank)).toEqual([1, 2, 4, 2]);
	});

	it("reverses the ranking between cutoffs", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B]), "a", [10, 20]);
		expect(cmp.cutoffs.map((c) => c.rows.map((r) => r.rank))).toEqual([
			[1, 2],
			[2, 1],
		]);
	});

	it("switching the baseline keeps every configuration's DPS identical", () => {
		const all = configs(["a", A], ["b", B], ["c", C]);
		const onA = compareConfigurations(all, "a", [10, 20]);
		const onC = compareConfigurations(all, "c", [10, 20]);
		const dps = (cmp: typeof onA) => cmp.cutoffs.map((c) => c.rows.map((r) => r.dps));
		expect(dps(onC)).toEqual(dps(onA));
		expect(onC.cutoffs[0].rows.find((r) => r.id === "c")).toMatchObject({
			deltaDps: 0,
			deltaPct: 0,
		});
		expect(onC.cutoffs[0].rows.find((r) => r.id === "a")!.deltaDps).toBe(40);
	});

	it("leaves percent undefined when the baseline DPS is 0", () => {
		// C has dealt nothing at 5 s.
		const cmp = compareConfigurations(configs(["c", C], ["a", A]), "c", [5]);
		const [c, a] = cmp.cutoffs[0].rows;
		expect(c).toMatchObject({ dps: 0, deltaDps: 0 });
		expect(a).toMatchObject({ dps: 1000 / 5, deltaDps: 200 });
		expect(c.deltaPct).toBeUndefined();
		expect(a.deltaPct).toBeUndefined();
	});

	it("leaves DPS and everything derived undefined at or before the pull", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B]), "a", [0]);
		expect(cmp.cutoffs[0].rows).toEqual([
			{ id: "a", total: 0 },
			{ id: "b", total: 0 },
		]);
	});

	it("includes elapsed downtime-free time only: a cutoff after the last hit divides by full time", () => {
		const cmp = compareConfigurations(configs(["d", D], ["a", A]), "d", [40]);
		expect(cmp.cutoffs[0].rows[0].dps).toBe(800 / 40);
	});

	it("uses potency for all configurations when one lacks expected damage", () => {
		const noDamage = { ...fakeResult(B), damage: undefined } as unknown as RotationResult;
		const cmp = compareConfigurations(
			[
				{ id: "a", result: fakeResult(A) },
				{ id: "b", result: noDamage },
			],
			"a",
			[10],
		);
		expect(cmp.metric).toBe("potency");
		expect(cmp.cutoffs[0].rows[0].total).toBe(100);
	});

	it("rejects an unknown baseline and duplicate ids", () => {
		expect(() => compareConfigurations(configs(["a", A], ["b", B]), "x", [10])).toThrow(
			/Baseline/,
		);
		expect(() => compareConfigurations(configs(["a", A], ["a", B]), "a", [10])).toThrow(
			/unique/,
		);
	});

	it("does not resimulate: results are only read", () => {
		const frozen = configs(["a", A], ["b", B]);
		let reads = 0;
		for (const c of frozen) {
			const events = c.result.damageEvents;
			Object.defineProperty(c.result, "damageEvents", {
				get() {
					reads++;
					return events;
				},
			});
		}
		const first = compareConfigurations(frozen, "a", [10, 20]);
		const second = compareConfigurations(frozen, "b", [10, 20]);
		// One read per configuration per call; no simulator is involved at all.
		expect(reads).toBe(4);
		expect(second.series.a).toEqual(first.series.a);
	});
});

describe("Rotation Lab - delta DPS series", () => {
	it("samples at every event time and extra time, after the pull, for non-baseline configurations", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B], ["c", C]), "a", []);
		const delta = deltaDpsSeries(cmp, [12, 0]);
		expect(delta.times).toEqual([5, 10, 12, 15, 20]);
		expect(delta.series.map((s) => s.id)).toEqual(["b", "c"]);
		// b: (800-1000)/5 = -40 at 5 s; same totals at 10 and 12 s divided by t; 20 s: 1800/20 - 1200/20.
		expect(delta.series[0].deltaDps[0]).toBeCloseTo(-40, 9);
		expect(delta.series[0].deltaDps[1]).toBeCloseTo(-20, 9);
		expect(delta.series[0].deltaDps[2]).toBeCloseTo(-200 / 12, 9);
		expect(delta.series[0].deltaDps[4]).toBeCloseTo(30, 9);
	});

	it("agrees with the cutoff table at a shared time", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B]), "a", [10]);
		const delta = deltaDpsSeries(cmp, [10]);
		const at = delta.times.indexOf(10);
		expect(delta.series[0].deltaDps[at]).toBe(cmp.cutoffs[0].rows[1].deltaDps);
	});

	it("drops the pull hit's float noise instead of dividing by it", () => {
		const cmp = compareConfigurations(
			configs(["a", [[3.6e-15, 100], ...A]], ["b", B]),
			"a",
			[],
		);
		expect(deltaDpsSeries(cmp).times[0]).toBe(5);
	});
});

describe("Rotation Lab - delta percent series", () => {
	it("gives a fraction per non-baseline configuration, at the delta DPS instants", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B], ["c", C]), "a", []);
		const pct = deltaPctSeries(cmp, [12, 0]);
		expect(pct.times).toEqual(deltaDpsSeries(cmp, [12, 0]).times);
		expect(pct.times).toEqual([5, 10, 12, 15, 20]);
		expect(pct.series.map((s) => s.id)).toEqual(["b", "c"]);
		// b/a: 800/1000 at 5 and 10 s, and at 12 s since no hit lands; 1800/1200 from 15 s.
		const b = pct.series[0].deltaPct;
		expect(b[0]).toBeCloseTo(-0.2, 12);
		expect(b[1]).toBeCloseTo(-0.2, 12);
		expect(b[2]).toBeCloseTo(-0.2, 12);
		expect(b[3]).toBeCloseTo(0.5, 12);
		expect(b[4]).toBeCloseTo(0.5, 12);
		// c/a: 0 at 5 s, 600/1000 at 10 s, 600/1200 at 15 s, 1000/1200 at 20 s.
		const c = pct.series[1].deltaPct;
		expect(c[0]).toBeCloseTo(-1, 12);
		expect(c[1]).toBeCloseTo(-0.4, 12);
		expect(c[3]).toBeCloseTo(-0.5, 12);
		expect(c[4]).toBeCloseTo(-1 / 6, 12);
	});

	it("is undefined only where the baseline DPS is 0", () => {
		// C deals nothing until 10 s.
		const cmp = compareConfigurations(configs(["c", C], ["a", A]), "c", []);
		const { times, series } = deltaPctSeries(cmp);
		expect(times).toEqual([5, 10, 15, 20]);
		expect(series[0].deltaPct[0]).toBeUndefined();
		// a/c: 1000/600 at 10 s.
		expect(series[0].deltaPct[1]).toBeCloseTo(2 / 3, 12);
		// Delta DPS still exists at 5 s, in absolute terms.
		expect(deltaDpsSeries(cmp).series[0].deltaDps[0]).toBeCloseTo(200, 12);
	});

	it("agrees with the cutoff table at a shared time", () => {
		const cmp = compareConfigurations(configs(["a", A], ["b", B]), "a", [10]);
		const pct = deltaPctSeries(cmp, [10]);
		const at = pct.times.indexOf(10);
		expect(pct.series[0].deltaPct[at]).toBe(cmp.cutoffs[0].rows[1].deltaPct);
	});

	it("drops the pull hit's float noise instead of dividing by it", () => {
		const cmp = compareConfigurations(
			configs(["a", [[3.6e-15, 100], ...A]], ["b", B]),
			"a",
			[],
		);
		expect(deltaPctSeries(cmp).times[0]).toBe(5);
	});
});

describe("Rotation Lab - baseline maths on simulated rotations", () => {
	it("matches the simulator's own totals and DPS for different skill speeds", () => {
		const steps = ["REAVING_FANGS", "REAVING_FANGS", "REAVING_FANGS", "SERPENTS_IRE"] as const;
		const options = (skillSpeed: number) => ({
			encounterRules: true,
			config: { fps: 0, skillSpeed },
			end: "settled" as const,
		});
		const fast = simulateRotation({ id: "fast", steps: [...steps] }, options(2000));
		const slow = simulateRotation({ id: "slow", steps: [...steps] }, options(400));
		const end = Math.max(fast.endTime, slow.endTime);
		const cmp = compareConfigurations(
			[
				{ id: "fast", result: fast },
				{ id: "slow", result: slow },
			],
			"slow",
			[end],
		);
		const [rowFast, rowSlow] = cmp.cutoffs[0].rows;
		expect(rowFast.total).toBeCloseTo(fast.damage!.expectedDamage, 6);
		expect(rowSlow.total).toBeCloseTo(slow.damage!.expectedDamage, 6);
		expect(rowFast.dps).toBeCloseTo(dpsAt(cumulativeSeries(fast, "damage"), end)!, 9);
		expect(rowFast.deltaDps).toBeCloseTo(rowFast.dps! - rowSlow.dps!, 9);
	});
});
