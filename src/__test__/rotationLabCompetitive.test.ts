import { beforeEach, describe, expect, it, vi } from "vitest";

import { compareConfigurations, cutoffTable } from "../RotationLab/comparison/baseline";
import { intervalAnalysis } from "../RotationLab/comparison/competitive";
import {
	cumulativeSeries,
	CumulativeSeries,
	dpsAt,
	totalAt,
} from "../RotationLab/comparison/compare";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationResult } from "../RotationLab/simulation/types";

// Passes through to the real simulator, and counts the calls.
vi.mock("../RotationLab/simulation/RotationSimulator", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../RotationLab/simulation/RotationSimulator")>();
	return { ...actual, simulateRotation: vi.fn(actual.simulateRotation) };
});

// Competitiveness and regret (comparison roadmap M3a; design spec 3, 3.1, 3.2). Fixtures are
// hand-computed; the arithmetic is in the comments.

type Hits = [time: number, damage: number][];
type Entries = Record<string, Hits>;

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

function seriesOf(entries: Entries): Record<string, CumulativeSeries> {
	const series: Record<string, CumulativeSeries> = {};
	for (const id of Object.keys(entries)) {
		series[id] = cumulativeSeries(fakeResult(entries[id]), "damage");
	}
	return series;
}

function analyse(entries: Entries, T1: number, T2: number, epsilonPct = 0.1) {
	return intervalAnalysis(seriesOf(entries), Object.keys(entries), T1, T2, epsilonPct);
}

// a: 1000 from 2 s, 2000 from 6 s. b: 1500 from 4 s, 2500 from 8 s.
// So the lead goes a, b, a, b at 2, 4, 6, 8 s.
const REVERSALS: Entries = {
	a: [
		[2, 1000],
		[6, 1000],
	],
	b: [
		[4, 1500],
		[8, 1000],
	],
};

// At 5 s: a 100000, b 99950, regret of b 50/100000 = 0.05%.
// From 9 s: b 100050, regret of a 50/100050 = 0.04998%.
const UNDER_EPSILON: Entries = {
	a: [[5, 100000]],
	b: [
		[5, 99950],
		[9, 100],
	],
};

// 1 s: a 300, b 200, c 100. 3 s: c 400. 5 s: b 450. 7 s: a 500.
const THREE: Entries = {
	a: [
		[1, 300],
		[7, 200],
	],
	b: [
		[1, 200],
		[5, 250],
	],
	c: [
		[1, 100],
		[3, 300],
	],
};

// 2 s: a 1000, b 1000 (tied leaders), c 999.5 (0.05% behind), d 500 (50% behind).
const FOUR: Entries = {
	a: [[2, 1000]],
	b: [[2, 1000]],
	c: [[2, 999.5]],
	d: [[2, 500]],
};

const entry = (analysis: ReturnType<typeof intervalAnalysis>, id: string) =>
	analysis.entries.find((e) => e.id === id)!;

describe("Rotation Lab - interval analysis", () => {
	it("computes coverage, regret and transitions across reversals between two entries", () => {
		const analysis = analyse(REVERSALS, 2, 10);
		expect(analysis.pieces.map((p) => [p.start, p.end, p.leaders])).toEqual([
			[2, 4, ["a"]],
			[4, 6, ["b"]],
			[6, 8, ["a"]],
			[8, 10, ["b"]],
			[10, 10, ["b"]],
		]);

		const a = entry(analysis, "a");
		const b = entry(analysis, "b");
		// Each leads for 2 + 2 of the 8 s.
		expect(a.leaderCoverage).toBeCloseTo(0.5, 12);
		expect(b.leaderCoverage).toBeCloseTo(0.5, 12);
		// Gaps are far beyond 0.10%, so competitive is the same as leading.
		expect(a.competitiveCoverage).toBeCloseTo(0.5, 12);
		expect(a.competitiveNotLeaderCoverage).toBe(0);

		// a's largest gap is 500 from 4 s, so 500/4. b's is 1000 from 2 s, so 1000/2.
		expect(a.maxRegretDps).toBeCloseTo(125, 12);
		expect(a.maxRegretDpsAt).toBe(4);
		expect(b.maxRegretDps).toBeCloseTo(500, 12);
		expect(b.maxRegretDpsAt).toBe(2);

		// a trails by 500 over [4,6) and [8,10); b by 1000 over [2,4) and 500 over [6,8).
		const meanA = (500 * Math.log(6 / 4) + 500 * Math.log(10 / 8)) / 8;
		const meanB = (1000 * Math.log(4 / 2) + 500 * Math.log(8 / 6)) / 8;
		expect(a.meanRegretDps).toBeCloseTo(meanA, 12);
		expect(b.meanRegretDps).toBeCloseTo(meanB, 12);

		expect(analysis.transitions).toEqual([
			{ time: 4, id: "a", kind: "exit", landings: [{ id: "b", amount: 1500 }] },
			{ time: 4, id: "b", kind: "enter", landings: [{ id: "b", amount: 1500 }] },
			{ time: 6, id: "a", kind: "enter", landings: [{ id: "a", amount: 1000 }] },
			{ time: 6, id: "b", kind: "exit", landings: [{ id: "a", amount: 1000 }] },
			{ time: 8, id: "a", kind: "exit", landings: [{ id: "b", amount: 1000 }] },
			{ time: 8, id: "b", kind: "enter", landings: [{ id: "b", amount: 1000 }] },
		]);
	});

	it("catches rapid reversals that whole-second samples would miss", () => {
		// a: 1000 at 1 s, +20 at 10.01, 10.03, 10.05. b: 1010 at 10.00, +20 at 10.02, 10.04.
		// Totals a/b: 1000/1010, 1020/1010, 1020/1030, 1040/1030, 1040/1050, 1060/1050.
		const analysis = analyse(
			{
				a: [
					[1, 1000],
					[10.01, 20],
					[10.03, 20],
					[10.05, 20],
				],
				b: [
					[10, 1010],
					[10.02, 20],
					[10.04, 20],
				],
			},
			10,
			10.06,
		);
		expect(analysis.pieces.map((p) => p.leaders[0])).toEqual([
			"b",
			"a",
			"b",
			"a",
			"b",
			"a",
			"a",
		]);
		expect(entry(analysis, "a").leaderCoverage).toBeCloseTo(0.5, 9);
		expect(entry(analysis, "b").leaderCoverage).toBeCloseTo(0.5, 9);
		// 5 swaps, each moving both entries. The gaps of 10 to 20 in about 1000 are all beyond 0.10%.
		expect(analysis.transitions).toHaveLength(10);
	});

	it("separates the exact leader from competitive-not-leader when gaps are under ε", () => {
		const analysis = analyse(UNDER_EPSILON, 5, 15, 0.1);
		const a = entry(analysis, "a");
		const b = entry(analysis, "b");
		// a leads [5,9), b leads [9,15).
		expect(a.leaderCoverage).toBeCloseTo(0.4, 12);
		expect(b.leaderCoverage).toBeCloseTo(0.6, 12);
		expect(a.competitiveCoverage).toBeCloseTo(1, 12);
		expect(b.competitiveCoverage).toBeCloseTo(1, 12);
		expect(a.competitiveNotLeaderCoverage).toBeCloseTo(0.6, 12);
		expect(b.competitiveNotLeaderCoverage).toBeCloseTo(0.4, 12);
		expect(analysis.transitions).toEqual([]);
		expect(a.maxRegretFraction).toBeCloseTo(50 / 100050, 12);
		expect(b.maxRegretFraction).toBeCloseTo(50 / 100000, 12);
	});

	it("handles three entries", () => {
		const analysis = analyse(THREE, 1, 9);
		expect(analysis.pieces.map((p) => p.leaders)).toEqual([["a"], ["c"], ["b"], ["a"], ["a"]]);
		// Pieces of 2 s each out of 8 s: a leads two, b and c one.
		expect(entry(analysis, "a").leaderCoverage).toBeCloseTo(0.5, 12);
		expect(entry(analysis, "b").leaderCoverage).toBeCloseTo(0.25, 12);
		expect(entry(analysis, "c").leaderCoverage).toBeCloseTo(0.25, 12);
		// a: 100/3 from 3 s beats 150/5 = 30 from 5 s. b: 100/1 at 1 s. c: 200/1 at 1 s.
		expect(entry(analysis, "a").maxRegretDps).toBeCloseTo(100 / 3, 12);
		expect(entry(analysis, "a").maxRegretDpsAt).toBe(3);
		expect(entry(analysis, "b").maxRegretDps).toBeCloseTo(100, 12);
		expect(entry(analysis, "c").maxRegretDps).toBeCloseTo(200, 12);
	});

	it("handles four entries with tied leaders, and the all-zero stretch before the first hit", () => {
		const analysis = analyse(FOUR, 1, 3);
		const [zero, after] = analysis.pieces;

		// Before any hit: all tied, all competitive, percentage regret N/A.
		expect(zero.leaders).toEqual(["a", "b", "c", "d"]);
		expect(zero.competitive).toEqual(["a", "b", "c", "d"]);
		expect(zero.regretFraction).toEqual({
			a: undefined,
			b: undefined,
			c: undefined,
			d: undefined,
		});

		expect(after.leaders).toEqual(["a", "b"]);
		expect(after.competitive).toEqual(["a", "b", "c"]);
		expect(after.regretFraction.a).toBe(0);
		expect(after.regretFraction.c).toBeCloseTo(0.0005, 12);
		expect(after.regretFraction.d).toBeCloseTo(0.5, 12);

		// a and b lead throughout, both at once: leader shares may sum past 1.
		expect(entry(analysis, "a").leaderCoverage).toBeCloseTo(1, 12);
		expect(entry(analysis, "b").leaderCoverage).toBeCloseTo(1, 12);
		const c = entry(analysis, "c");
		expect(c.leaderCoverage).toBeCloseTo(0.5, 12);
		expect(c.competitiveCoverage).toBeCloseTo(1, 12);
		expect(c.competitiveNotLeaderCoverage).toBeCloseTo(0.5, 12);
		const d = entry(analysis, "d");
		expect(d.leaderCoverage).toBeCloseTo(0.5, 12);
		expect(d.competitiveCoverage).toBeCloseTo(0.5, 12);
		expect(d.competitiveNotLeaderCoverage).toBe(0);

		// Only regret after 2 s counts: d 500/2 at 2 s, c 0.5/2 at 2 s.
		expect(d.maxRegretDps).toBeCloseTo(250, 12);
		expect(d.maxRegretDpsAt).toBe(2);
		expect(c.maxRegretDps).toBeCloseTo(0.25, 12);
		expect(d.meanRegretDps).toBeCloseTo((500 * Math.log(3 / 2)) / 2, 12);

		// Only d moves at 2 s, and all four hits are reported with it.
		expect(analysis.transitions).toEqual([
			{
				time: 2,
				id: "d",
				kind: "exit",
				landings: [
					{ id: "a", amount: 1000 },
					{ id: "b", amount: 1000 },
					{ id: "c", amount: 999.5 },
					{ id: "d", amount: 500 },
				],
			},
		]);
	});

	it("treats an interval with no damage at all as a full tie with N/A percentage regret", () => {
		const analysis = analyse({ a: [[20, 100]], b: [[30, 100]] }, 1, 3);
		for (const e of analysis.entries) {
			expect(e.leaderCoverage).toBeCloseTo(1, 12);
			expect(e.competitiveCoverage).toBeCloseTo(1, 12);
			expect(e.competitiveNotLeaderCoverage).toBe(0);
			expect(e.maxRegretDps).toBe(0);
			expect(e.maxRegretDpsAt).toBe(1);
			expect(e.maxRegretFraction).toBeUndefined();
			expect(e.meanRegretDps).toBe(0);
		}
		expect(analysis.transitions).toEqual([]);
	});

	it("gives a single entry full coverage and no regret", () => {
		const [only] = analyse({ a: REVERSALS.a }, 2, 10).entries;
		expect(only).toMatchObject({ maxRegretDps: 0, maxRegretFraction: 0, meanRegretDps: 0 });
		expect(only.leaderCoverage).toBeCloseTo(1, 12);
	});

	it("rejects an invalid interval, ε or id list", () => {
		const series = seriesOf(REVERSALS);
		const ids = ["a", "b"];
		expect(() => intervalAnalysis(series, ids, 0, 10, 0.1)).toThrow(/0 < T1 < T2/);
		expect(() => intervalAnalysis(series, ids, -1, 10, 0.1)).toThrow(/0 < T1 < T2/);
		expect(() => intervalAnalysis(series, ids, 10, 10, 0.1)).toThrow(/0 < T1 < T2/);
		expect(() => intervalAnalysis(series, ids, 10, 5, 0.1)).toThrow(/0 < T1 < T2/);
		expect(() => intervalAnalysis(series, ids, 1, Infinity, 0.1)).toThrow(/0 < T1 < T2/);
		expect(() => intervalAnalysis(series, ids, 2, 10, -0.1)).toThrow(/epsilonPct/);
		expect(() => intervalAnalysis(series, ids, 2, 10, NaN)).toThrow(/epsilonPct/);
		expect(() => intervalAnalysis(series, [], 2, 10, 0.1)).toThrow(/At least one/);
		expect(() => intervalAnalysis(series, ["a", "a"], 2, 10, 0.1)).toThrow(/unique/);
		expect(() => intervalAnalysis(series, ["a", "x"], 2, 10, 0.1)).toThrow(/"x"/);
	});
});

describe("Rotation Lab - interval analysis at event boundaries", () => {
	it("counts a hit landing exactly at T1, and does not report it as a transition", () => {
		// a 100 at 5 s, b 200 at 5 s: b already leads at T1 = 5.
		const analysis = analyse({ a: [[5, 100]], b: [[5, 200]] }, 5, 10);
		expect(analysis.pieces[0].totals).toEqual({ a: 100, b: 200 });
		expect(analysis.pieces[0].leaders).toEqual(["b"]);
		expect(analysis.transitions).toEqual([]);
	});

	it("gives a hit landing exactly at T2 no coverage, but its instant still counts", () => {
		// 2 s: a 100, b 90. 6 s: b 120. 10 s: a 400, landing exactly at T2.
		const entries: Entries = {
			a: [
				[2, 100],
				[10, 300],
			],
			b: [
				[2, 90],
				[6, 30],
			],
		};
		const analysis = analyse(entries, 2, 10);
		expect(analysis.pieces.map((p) => [p.start, p.end, p.leaders])).toEqual([
			[2, 6, ["a"]],
			[6, 10, ["b"]],
			[10, 10, ["a"]],
		]);
		const a = entry(analysis, "a");
		const b = entry(analysis, "b");
		expect(a.leaderCoverage).toBeCloseTo(0.5, 12);
		expect(b.leaderCoverage).toBeCloseTo(0.5, 12);
		// Mean regret ignores the instant: a 20 over [6,10), b 10 over [2,6).
		expect(a.meanRegretDps).toBeCloseTo((20 * Math.log(10 / 6)) / 8, 12);
		expect(b.meanRegretDps).toBeCloseTo((10 * Math.log(6 / 2)) / 8, 12);
		// Max regret includes it: b is 280 behind at 10 s, 280/10 = 28, more than 10/2 = 5 at 2 s.
		expect(b.maxRegretDps).toBeCloseTo(28, 12);
		expect(b.maxRegretDpsAt).toBe(10);
		expect(analysis.transitions).toEqual([
			{ time: 6, id: "a", kind: "exit", landings: [{ id: "b", amount: 30 }] },
			{ time: 6, id: "b", kind: "enter", landings: [{ id: "b", amount: 30 }] },
			{ time: 10, id: "a", kind: "enter", landings: [{ id: "a", amount: 300 }] },
			{ time: 10, id: "b", kind: "exit", landings: [{ id: "a", amount: 300 }] },
		]);

		// That instant agrees with the cutoff table at T2.
		const series = seriesOf(entries);
		const rows = cutoffTable(series, ["a", "b"], "a", 10).rows;
		expect(rows.map((r) => r.total)).toEqual([400, 120]);
		expect(rows[0].dps! - rows[1].dps!).toBeCloseTo(b.maxRegretDps, 12);
	});

	it("merges simultaneous landings, including times apart only by float noise", () => {
		// 5 s: a 100, b 150. 7.5 s: a +200 and b +100 give 300 and 250: a takes the lead.
		for (const later of [7.5, 7.500000000000002, 7.5 + 5e-7]) {
			const analysis = analyse(
				{
					a: [
						[5, 100],
						[7.5, 200],
					],
					b: [
						[5, 150],
						[later, 100],
					],
				},
				5,
				10,
			);
			expect(analysis.pieces.map((p) => [p.start, p.end])).toEqual([
				[5, 7.5],
				[7.5, 10],
				[10, 10],
			]);
			expect(analysis.pieces[1].totals).toEqual({ a: 300, b: 250 });
			expect(analysis.transitions.map((t) => [t.time, t.id, t.kind])).toEqual([
				[7.5, "a", "enter"],
				[7.5, "b", "exit"],
			]);
			expect(analysis.transitions[0].landings).toEqual([
				{ id: "a", amount: 200 },
				{ id: "b", amount: 100 },
			]);
		}
	});

	it("applies the time tolerance at the endpoints exactly as totalAt does", () => {
		const within = 5e-7;
		const beyond = 2e-6;
		const analysis = analyse(
			{
				// Within tolerance after T1: already in the first piece.
				a: [[10 + within, 100]],
				// Within tolerance before T2: no interior piece, but in the closing instant.
				b: [
					[10, 90],
					[20 - within, 50],
				],
				// Within tolerance after T2 counts; beyond it does not.
				c: [
					[10, 80],
					[20 + within, 10],
					[20 + beyond, 1000],
				],
			},
			10,
			20,
		);
		expect(analysis.pieces.map((p) => [p.start, p.end])).toEqual([
			[10, 20],
			[20, 20],
		]);
		expect(analysis.pieces[0].totals).toEqual({ a: 100, b: 90, c: 80 });
		expect(analysis.pieces[1].totals).toEqual({ a: 100, b: 140, c: 90 });
		// Reported at T2 itself, the instant the hit counts as landing.
		expect(analysis.transitions[0]).toMatchObject({ time: 20, id: "a", kind: "exit" });

		// A hit just beyond the tolerance of T1 does start a piece of its own.
		const split = analyse(
			{
				a: [[10 + beyond, 100]],
				b: [[10, 90]],
			},
			10,
			20,
		);
		expect(split.pieces.map((p) => p.start)).toEqual([10, 10 + beyond, 20]);
		expect(split.pieces[0].totals).toEqual({ a: 0, b: 90 });
		expect(split.pieces[1].totals).toEqual({ a: 100, b: 90 });
	});

	it("handles a very short interval with a reversal inside it", () => {
		// At 10 s: a 1000, b 999. At 10.0005: b 1001. So a trails by 1 in the second half.
		const analysis = analyse(
			{
				a: [[1, 1000]],
				b: [
					[1, 999],
					[10.0005, 2],
				],
			},
			10,
			10.001,
			0.01,
		);
		expect(entry(analysis, "a").leaderCoverage).toBeCloseTo(0.5, 9);
		expect(entry(analysis, "b").leaderCoverage).toBeCloseTo(0.5, 9);
		// Gap 1 over about 10 s is about 0.1 DPS at any time in the interval.
		expect(entry(analysis, "a").meanRegretDps).toBeCloseTo(
			Math.log(10.001 / 10.0005) / 0.001,
			9,
		);
		expect(entry(analysis, "b").meanRegretDps).toBeCloseTo(Math.log(10.0005 / 10) / 0.001, 9);
		expect(entry(analysis, "a").maxRegretDps).toBeCloseTo(1 / 10.0005, 12);
		expect(entry(analysis, "b").maxRegretDps).toBeCloseTo(1 / 10, 12);
	});

	it("handles an interval shorter than the time tolerance", () => {
		// T1 and T2 are one instant. T1 sees a 100, b 90. The hit at 10 + 1.2e-6 is beyond T1's
		// tolerance but within T2's, so it counts only at the closing instant.
		const T1 = 10;
		const T2 = 10 + 5e-7;
		const analysis = analyse(
			{
				a: [[1, 100]],
				b: [
					[1, 90],
					[10 + 1.2e-6, 50],
				],
			},
			T1,
			T2,
		);
		expect(analysis.pieces.map((p) => p.leaders)).toEqual([["a"], ["b"]]);
		const a = entry(analysis, "a");
		const b = entry(analysis, "b");
		expect(a.leaderCoverage).toBeCloseTo(1, 12);
		expect(b.leaderCoverage).toBe(0);
		// Gap 10 at about 10 s: the mean is 1 DPS even with so short an interval.
		expect(b.meanRegretDps).toBeCloseTo(1, 5);
		expect(a.meanRegretDps).toBe(0);
		expect(analysis.transitions.map((t) => [t.time, t.id, t.kind])).toEqual([
			[T2, "a", "exit"],
			[T2, "b", "enter"],
		]);
	});
});

describe("Rotation Lab - ε and units", () => {
	it("reads ε in percentage points: 0.10 means 0.10%", () => {
		// 5% behind must be outside 0.10, which it would not be if 0.10 were read as a fraction.
		const fivePct = { a: [[1, 1000]], b: [[1, 950]] } as Entries;
		expect(analyse(fivePct, 1, 2, 0.1).pieces[0].competitive).toEqual(["a"]);
		// 1% behind: inside 1.00, outside 0.99.
		const onePct = { a: [[1, 1000]], b: [[1, 990]] } as Entries;
		expect(analyse(onePct, 1, 2, 1).pieces[0].competitive).toEqual(["a", "b"]);
		expect(analyse(onePct, 1, 2, 0.99).pieces[0].competitive).toEqual(["a"]);
	});

	it("counts a gap of exactly ε as competitive, and one just past it as not", () => {
		const gap = (b: number) => ({ a: [[1, 100000]], b: [[1, b]] }) as Entries;
		expect(analyse(gap(99900), 1, 2, 0.1).pieces[0].competitive).toEqual(["a", "b"]);
		expect(analyse(gap(99899), 1, 2, 0.1).pieces[0].competitive).toEqual(["a"]);
		// Past ε by 2e-9 of the best: still outside, so the float slack is smaller than that.
		const near = { a: [[1, 1e9]], b: [[1, 1e9 * 0.999 - 2]] } as Entries;
		expect(analyse(near, 1, 2, 0.1).pieces[0].competitive).toEqual(["a"]);
	});

	it("keeps exact ties competitive at ε = 0, and leaders always competitive", () => {
		const analysis = analyse(FOUR, 1, 3, 0);
		expect(analysis.pieces[1].competitive).toEqual(["a", "b"]);
		for (const piece of analysis.pieces) {
			for (const id of piece.leaders) expect(piece.competitive).toContain(id);
		}
	});

	it("treats totals differing only by float noise as tied, as the cutoff table does", () => {
		const noise = 0.1 + 0.2; // 0.30000000000000004
		const analysis = analyse({ a: [[1, 1000 + noise]], b: [[1, 1000.3]] }, 1, 2, 0);
		expect(analysis.pieces[0].leaders).toEqual(["a", "b"]);
		expect(entry(analysis, "b").leaderCoverage).toBeCloseTo(1, 12);
	});

	it("changing ε changes only the competitive classification", () => {
		const strict = analyse(UNDER_EPSILON, 5, 15, 0.01);
		const loose = analyse(UNDER_EPSILON, 5, 15, 1);

		expect(entry(strict, "b").competitiveCoverage).toBeCloseTo(0.6, 12);
		expect(entry(loose, "b").competitiveCoverage).toBeCloseTo(1, 12);
		expect(strict.transitions.map((t) => [t.time, t.id, t.kind])).toEqual([
			[9, "a", "exit"],
			[9, "b", "enter"],
		]);
		expect(loose.transitions).toEqual([]);

		const unclassified = (analysis: typeof strict) => ({
			pieces: analysis.pieces.map(({ competitive: _ignored, ...rest }) => rest),
			entries: analysis.entries.map(
				({
					competitiveCoverage: _coverage,
					competitiveNotLeaderCoverage: _notLeader,
					...rest
				}) => rest,
			),
		});
		expect(unclassified(strict)).toEqual(unclassified(loose));
	});
});

describe("Rotation Lab - competitiveness is independent of the baseline", () => {
	// Hits for compareConfigurations; c is far behind, so baseline-relative maths would rate it best
	// against itself and everything else above it.
	const entries: Entries = {
		a: [[2, 100000]],
		b: [[2, 99950]],
		c: [[2, 50000]],
	};
	const configs = Object.keys(entries).map((id) => ({
		id,
		result: fakeResult(entries[id]),
	}));

	it("gives the same analysis whichever configuration is the baseline", () => {
		const ids = ["a", "b", "c"];
		const onA = compareConfigurations(configs, "a", [5]);
		const onC = compareConfigurations(configs, "c", [5]);
		expect(onC.cutoffs[0].rows[0].deltaDps).not.toBe(onA.cutoffs[0].rows[0].deltaDps);
		const analysisOnA = intervalAnalysis(onA.series, ids, 2, 10, 0.1);
		const analysisOnC = intervalAnalysis(onC.series, ids, 2, 10, 0.1);
		expect(analysisOnC).toEqual(analysisOnA);
		// Measured against the best, so the baseline c counts as 50% behind, not as the reference.
		expect(analysisOnC.pieces[0].competitive).toEqual(["a", "b"]);
		expect(analysisOnC.pieces[0].regretFraction.c).toBeCloseTo(0.5, 12);
	});
});

describe("Rotation Lab - interval analysis against independent checks", () => {
	// Midpoint rule on the definition, using the running DPS of `compare.ts`.
	function sampledRegret(entries: Entries, T1: number, T2: number, step: number) {
		const series = seriesOf(entries);
		const ids = Object.keys(entries);
		const steps = Math.round((T2 - T1) / step);
		const integrals = ids.map(() => 0);
		const leadSteps = ids.map(() => 0);
		for (let k = 0; k < steps; k++) {
			const t = T1 + (k + 0.5) * step;
			const dps = ids.map((id) => dpsAt(series[id], t)!);
			const best = Math.max(...dps);
			dps.forEach((d, i) => {
				integrals[i] += (best - d) * step;
				if (d === best) leadSteps[i]++;
			});
		}
		return ids.map((id, i) => ({
			id,
			mean: integrals[i] / (T2 - T1),
			leaderCoverage: leadSteps[i] / steps,
		}));
	}

	it.each([
		["two entries", REVERSALS, 2, 10],
		["three entries", THREE, 1, 9],
		["four entries, with an all-zero stretch", FOUR, 1, 3],
		["an interval not on event boundaries", THREE, 1.37, 8.21],
	] as [string, Entries, number, number][])(
		"closed-form mean regret and coverage match fine sampling: %s",
		(_name, entries, T1, T2) => {
			const analysis = analyse(entries, T1, T2);
			for (const sampled of sampledRegret(entries, T1, T2, 1e-3)) {
				const exact = entry(analysis, sampled.id);
				expect(exact.meanRegretDps).toBeCloseTo(sampled.mean, 2);
				expect(exact.leaderCoverage).toBeCloseTo(sampled.leaderCoverage, 2);
			}
		},
	);

	it("agrees with the cutoff table's rank and DPS inside every piece", () => {
		for (const [entries, T1, T2] of [
			[REVERSALS, 2, 10],
			[THREE, 1, 9],
			[FOUR, 1, 3],
			[UNDER_EPSILON, 5, 15],
		] as [Entries, number, number][]) {
			const series = seriesOf(entries);
			const ids = Object.keys(entries);
			const analysis = intervalAnalysis(series, ids, T1, T2, 0.1);
			for (const piece of analysis.pieces) {
				for (const t of [piece.start, (piece.start + piece.end) / 2]) {
					const { rows } = cutoffTable(series, ids, ids[0], t);
					expect(rows.filter((r) => r.rank === 1).map((r) => r.id)).toEqual(
						piece.leaders,
					);
					expect(rows.map((r) => r.total)).toEqual(ids.map((id) => piece.totals[id]));
				}
			}
		}
	});

	it("never exceeds the largest regret seen by sampling, and reaches it at the reported time", () => {
		const series = seriesOf(THREE);
		const ids = Object.keys(THREE);
		const analysis = intervalAnalysis(series, ids, 1, 9, 0.1);
		const regretAt = (id: string, t: number) =>
			Math.max(...ids.map((other) => dpsAt(series[other], t)!)) - dpsAt(series[id], t)!;
		for (const e of analysis.entries) {
			expect(regretAt(e.id, e.maxRegretDpsAt)).toBeCloseTo(e.maxRegretDps, 12);
			for (let t = 1; t <= 9; t += 0.01) {
				expect(regretAt(e.id, t)).toBeLessThanOrEqual(e.maxRegretDps + 1e-9);
			}
		}
	});

	it("reads the running totals from totalAt", () => {
		const series = seriesOf(REVERSALS);
		const analysis = intervalAnalysis(series, ["a", "b"], 2, 10, 0.1);
		for (const piece of analysis.pieces) {
			expect(piece.totals.a).toBe(totalAt(series.a, piece.start));
			expect(piece.totals.b).toBe(totalAt(series.b, piece.start));
		}
	});
});

describe("Rotation Lab - interval analysis does not resimulate", () => {
	const simulate = vi.mocked(simulateRotation);
	beforeEach(() => {
		simulate.mockClear();
	});

	it("runs no simulation and leaves the series untouched when ε, interval or baseline change", () => {
		const steps = ["REAVING_FANGS", "REAVING_FANGS", "REAVING_FANGS", "SERPENTS_IRE"] as const;
		const options = (skillSpeed: number) => ({
			encounterRules: true,
			config: { fps: 0, skillSpeed },
			end: "settled" as const,
		});
		const fast = simulateRotation({ id: "fast", steps: [...steps] }, options(2000));
		const slow = simulateRotation({ id: "slow", steps: [...steps] }, options(400));
		const end = Math.max(fast.endTime, slow.endTime);
		expect(simulate).toHaveBeenCalledTimes(2);

		const configs = [
			{ id: "fast", result: fast },
			{ id: "slow", result: slow },
		];
		const comparison = compareConfigurations(configs, "fast", [end]);
		const onSlow = compareConfigurations(configs, "slow", [end]);
		const ids = comparison.ids;
		for (const s of [...Object.values(comparison.series), ...Object.values(onSlow.series)]) {
			Object.freeze(s.times);
			Object.freeze(s.totals);
		}

		// Reads of the raw results from here on would mean something is being recomputed from them.
		let reads = 0;
		for (const c of configs) {
			const events = c.result.damageEvents;
			Object.defineProperty(c.result, "damageEvents", {
				get() {
					reads++;
					return events;
				},
			});
		}

		const first = intervalAnalysis(comparison.series, ids, 1, end, 0.1);
		intervalAnalysis(comparison.series, ids, 1, end, 1);
		intervalAnalysis(comparison.series, ids, 2, end / 2, 0.01);
		const again = intervalAnalysis(onSlow.series, ids, 1, end, 0.1);

		expect(simulate).toHaveBeenCalledTimes(2);
		expect(reads).toBe(0);
		expect(again).toEqual(first);
		// The real rotation: the faster skill speed reaches the same damage sooner.
		expect(first.pieces.length).toBeGreaterThan(2);
		expect(entry(first, "fast").leaderCoverage).toBeGreaterThan(0);
	});
});
