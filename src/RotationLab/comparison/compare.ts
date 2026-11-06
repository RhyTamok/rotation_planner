import { GaugeValue } from "../rules/resourceTracking";
import { RotationResult } from "../simulation/types";

// Pure comparison maths over simulation results. Times are display times in seconds (0 = pull).

// What the comparison adds up: expected damage when every result has it, otherwise potency.
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

// Simulated times are computed floats (a hit due at 7.5 s can be recorded at 7.500000000000002 s),
// so times this close, in seconds, count as the same instant. Far below any real gap between hits.
export const TIME_TOLERANCE = 1e-6;

// Index of the last step at or before `limit`; -1 if none.
function lastIndex(series: CumulativeSeries, limit: number): number {
	let lo = 0;
	let hi = series.times.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (series.times[mid] <= limit) {
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
	const i = lastIndex(series, t + TIME_TOLERANCE);
	return i < 0 ? 0 : series.totals[i];
}

// Total over the fight so far divided by the time since the pull; undefined before the pull.
export function dpsAt(series: CumulativeSeries, t: number): number | undefined {
	return t > 0 ? totalAt(series, t) / t : undefined;
}

// The running total a window boundary at `t` splits on. It equals `totalAt`, except that a boundary
// at the pull comes before the pull hit, which has no earlier window to belong to.
function totalAtWindowBoundary(series: CumulativeSeries, t: number): number {
	if (Math.abs(t) > TIME_TOLERANCE) return totalAt(series, t);
	const i = lastIndex(series, -TIME_TOLERANCE);
	return i < 0 ? 0 : series.totals[i];
}

// Total of the hits landing in (start, end], matching the inclusive cutoffs of `totalAt`: a hit at
// `start` belongs to the previous window, so touching windows never double count. The exception is
// the pull hit, which belongs to a window starting at 0 s and not to one ending there.
export function totalBetween(series: CumulativeSeries, start: number, end: number): number {
	return totalAtWindowBoundary(series, end) - totalAtWindowBoundary(series, start);
}

// Gauges as of `t`: the snapshot of the last action pressed at or before `t` (taken at the end of
// its animation lock). Undefined before the first action.
export function gaugesAt(result: RotationResult, t: number): GaugeValue[] | undefined {
	let last: RotationResult["actions"][number] | undefined;
	for (const action of result.actions) {
		if (action.startTime > t + TIME_TOLERANCE) break;
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
