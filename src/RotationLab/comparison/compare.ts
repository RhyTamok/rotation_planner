import { GaugeValue } from "../rules/resourceTracking";
import { RotationResult } from "../simulation/types";

// Pure comparison maths over simulation results. Times are display times in seconds (0 = pull).

// What the comparison adds up: expected damage when both results have it, otherwise potency.
export type ComparisonMetric = "damage" | "potency";

// Running total as a step function: after `times[i]` the total is `totals[i]`.
export interface CumulativeSeries {
	metric: ComparisonMetric;
	times: number[];
	totals: number[];
}

export function comparisonMetric(...results: RotationResult[]): ComparisonMetric {
	return results.every((r) => r.damage !== undefined) ? "damage" : "potency";
}

// Hits that landed on the boss, accumulated in time order. Hits landing at the same time are
// merged into one step. Auto-attacks are included, as in the result totals.
export function cumulativeSeries(
	result: RotationResult,
	metric: ComparisonMetric,
): CumulativeSeries {
	const events = result.damageEvents
		.filter((e) => e.hitTarget)
		.map((e) => ({
			time: e.time,
			amount: metric === "damage" ? (e.expectedDamage ?? 0) : e.potency,
		}))
		.sort((a, b) => a.time - b.time);
	const times: number[] = [];
	const totals: number[] = [];
	let total = 0;
	for (const e of events) {
		total += e.amount;
		if (times.length > 0 && times[times.length - 1] === e.time) {
			totals[totals.length - 1] = total;
		} else {
			times.push(e.time);
			totals.push(total);
		}
	}
	return { metric, times, totals };
}

// Index of the last step at or before `t` (inclusive) or strictly before it; -1 if none.
function lastIndex(series: CumulativeSeries, t: number, inclusive: boolean): number {
	let lo = 0;
	let hi = series.times.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const before = inclusive ? series.times[mid] <= t : series.times[mid] < t;
		if (before) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}

// Total of every hit that landed at or before `t`.
export function totalAt(series: CumulativeSeries, t: number): number {
	const i = lastIndex(series, t, true);
	return i < 0 ? 0 : series.totals[i];
}

// Total over the fight so far divided by the time since the pull; undefined before the pull.
export function dpsAt(series: CumulativeSeries, t: number): number | undefined {
	return t > 0 ? totalAt(series, t) / t : undefined;
}

// Total of the hits landing in [start, end], both inclusive.
export function totalBetween(series: CumulativeSeries, start: number, end: number): number {
	const before = lastIndex(series, start, false);
	return totalAt(series, end) - (before < 0 ? 0 : series.totals[before]);
}

// A − B at every time either total changes, for plotting the difference over time.
export function differenceSeries(
	a: CumulativeSeries,
	b: CumulativeSeries,
): { times: number[]; diffs: number[] } {
	const times = [...new Set([...a.times, ...b.times])].sort((x, y) => x - y);
	return { times, diffs: times.map((t) => totalAt(a, t) - totalAt(b, t)) };
}

export interface LeadChange {
	time: number;
	// Which rotation is ahead from this time on.
	leader: "a" | "b";
}

// Every time the rotation ahead on cumulative total changes. The first entry is when one first
// pulls ahead; ties do not end a lead, only the other rotation getting ahead does.
export function leadChanges(a: CumulativeSeries, b: CumulativeSeries): LeadChange[] {
	const { times, diffs } = differenceSeries(a, b);
	const changes: LeadChange[] = [];
	times.forEach((time, i) => {
		const diff = diffs[i];
		if (diff === 0) return;
		const leader = diff > 0 ? "a" : "b";
		if (changes[changes.length - 1]?.leader !== leader) changes.push({ time, leader });
	});
	return changes;
}

// Whole seconds from `from` to `to` (both rounded inward), never before the first second of the
// fight: DPS is undefined at 0 s.
export function sampleTimes(from: number, to: number, step = 1): number[] {
	const times: number[] = [];
	for (let t = Math.max(step, Math.ceil(from / step) * step); t <= to + 1e-9; t += step) {
		times.push(t);
	}
	return times;
}

// Running DPS (total so far / time since the pull) at each of `times`.
export function dpsSamples(series: CumulativeSeries, times: number[]): number[] {
	return times.map((t) => dpsAt(series, t) ?? 0);
}

// Gauges as of `t`: the snapshot of the last action pressed at or before `t` (taken at the end of
// its animation lock). Undefined before the first action.
export function gaugesAt(result: RotationResult, t: number): GaugeValue[] | undefined {
	let last: RotationResult["actions"][number] | undefined;
	for (const action of result.actions) {
		if (action.startTime > t) break;
		last = action;
	}
	return last?.resources.gauges;
}

export interface TimeWindow {
	start: number;
	end: number;
	label?: string;
}

// Merges overlapping or touching party buff windows into burst windows.
export function burstWindows(result: RotationResult): TimeWindow[] {
	const windows = result.encounter.partyBuffs
		.map((w) => ({ start: w.time, end: w.time + w.duration }))
		.sort((x, y) => x.start - y.start);
	const merged: TimeWindow[] = [];
	for (const w of windows) {
		const last = merged[merged.length - 1];
		if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
		else merged.push({ ...w });
	}
	return merged;
}

export interface CutoffComparison {
	time: number;
	a: number;
	b: number;
	dpsA?: number;
	dpsB?: number;
	gaugesA?: GaugeValue[];
	gaugesB?: GaugeValue[];
}

export interface WindowComparison extends TimeWindow {
	a: number;
	b: number;
}

export interface RotationComparison {
	metric: ComparisonMetric;
	a: CumulativeSeries;
	b: CumulativeSeries;
	cutoffs: CutoffComparison[];
	leadChanges: LeadChange[];
	windows: WindowComparison[];
}

// Compares two results simulated under the same scenario. Burst windows default to that
// scenario's merged party buffs (taken from `a`; both results carry the same ones).
export function compareRotations(
	resultA: RotationResult,
	resultB: RotationResult,
	cutoffs: number[],
	windows: TimeWindow[] = burstWindows(resultA),
): RotationComparison {
	const metric = comparisonMetric(resultA, resultB);
	const a = cumulativeSeries(resultA, metric);
	const b = cumulativeSeries(resultB, metric);
	return {
		metric,
		a,
		b,
		cutoffs: cutoffs.map((time) => ({
			time,
			a: totalAt(a, time),
			b: totalAt(b, time),
			dpsA: dpsAt(a, time),
			dpsB: dpsAt(b, time),
			gaugesA: gaugesAt(resultA, time),
			gaugesB: gaugesAt(resultB, time),
		})),
		leadChanges: leadChanges(a, b),
		windows: windows.map((w) => ({
			...w,
			a: totalBetween(a, w.start, w.end),
			b: totalBetween(b, w.start, w.end),
		})),
	};
}
