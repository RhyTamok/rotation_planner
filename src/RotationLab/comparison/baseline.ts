import { RotationResult } from "../simulation/types";
import {
	comparisonMetric,
	ComparisonMetric,
	cumulativeSeries,
	CumulativeSeries,
	dpsAt,
	TIME_TOLERANCE,
	totalAt,
} from "./compare";

// N configurations against a baseline (spec 2.2; roadmap M2). Pure maths over `compare.ts`: no
// simulation runs here, so changing the baseline or the cutoffs never resimulates anything.

export interface ConfigurationResult {
	id: string;
	result: RotationResult;
}

// One configuration at one cutoff. DPS and everything derived from it is undefined at t <= 0
// (before the pull there is no elapsed time).
export interface CutoffRow {
	id: string;
	total: number;
	dps?: number;
	// DPS minus the baseline's DPS at the same cutoff. Exactly 0 for the baseline.
	deltaDps?: number;
	// deltaDps / baseline DPS; undefined when the baseline DPS is 0 (so also for the baseline row).
	deltaPct?: number;
	// 1 = highest DPS. Ties share the best rank of the group (1, 1, 3).
	rank?: number;
}

export interface CutoffTable {
	time: number;
	// In the order the configurations were given.
	rows: CutoffRow[];
}

export interface BaselineComparison {
	metric: ComparisonMetric;
	baselineId: string;
	// Configuration ids in the order given.
	ids: string[];
	series: Record<string, CumulativeSeries>;
	cutoffs: CutoffTable[];
}

// DPS values closer than this, relative to their size, tie: equal totals summed in a different
// order differ by float noise.
export const TIE_TOLERANCE = 1e-9;

function assertValid(configs: { id: string }[], baselineId: string) {
	const ids = new Set(configs.map((c) => c.id));
	if (ids.size !== configs.length) throw new Error("Configuration ids must be unique.");
	if (!ids.has(baselineId)) throw new Error(`Baseline "${baselineId}" is not a configuration.`);
}

export function rankOf(dps: number, all: number[]): number {
	const tolerance = TIE_TOLERANCE * Math.max(1, Math.abs(dps));
	return 1 + all.filter((other) => other > dps + tolerance).length;
}

export function cutoffTable(
	series: Record<string, CumulativeSeries>,
	ids: string[],
	baselineId: string,
	time: number,
): CutoffTable {
	const dps = ids.map((id) => dpsAt(series[id], time));
	const baselineDps = dpsAt(series[baselineId], time);
	const defined = dps.filter((d): d is number => d !== undefined);
	return {
		time,
		rows: ids.map((id, i) => {
			const own = dps[i];
			const row: CutoffRow = { id, total: totalAt(series[id], time) };
			if (own === undefined || baselineDps === undefined) return row;
			row.dps = own;
			row.deltaDps = id === baselineId ? 0 : own - baselineDps;
			if (baselineDps !== 0) row.deltaPct = row.deltaDps / baselineDps;
			row.rank = rankOf(own, defined);
			return row;
		}),
	};
}

// Every configuration against `baselineId` at each cutoff. All results must come from the same
// scenario; the metric is expected damage when all have it, otherwise potency.
export function compareConfigurations(
	configs: ConfigurationResult[],
	baselineId: string,
	cutoffs: number[],
): BaselineComparison {
	assertValid(configs, baselineId);
	const metric = comparisonMetric(...configs.map((c) => c.result));
	const series: Record<string, CumulativeSeries> = {};
	for (const c of configs) series[c.id] = cumulativeSeries(c.result, metric);
	const ids = configs.map((c) => c.id);
	return {
		metric,
		baselineId,
		ids,
		series,
		cutoffs: cutoffs.map((time) => cutoffTable(series, ids, baselineId, time)),
	};
}

export type SeriesComparison = Pick<BaselineComparison, "baselineId" | "ids" | "series">;

// Ascending and after the pull: DPS is undefined at or before it.
function deltaSampleTimes(comparison: SeriesComparison, extraTimes: number[]): number[] {
	const { ids, series } = comparison;
	return [...new Set([...ids.flatMap((id) => series[id].times), ...extraTimes])]
		.filter((t) => t > TIME_TOLERANCE)
		.sort((a, b) => a - b);
}

export interface DeltaDpsSeries {
	// Ascending, all after the pull.
	times: number[];
	// Per non-baseline configuration, in the given order: deltaDps at each of `times`.
	series: { id: string; deltaDps: number[] }[];
}

// deltaDps for every non-baseline configuration, sampled at each instant a total changes in any
// configuration, plus `extraTimes` (cutoffs, the end of the fight). Between two such instants the
// totals are constant, so deltaDps = (Ta - Tb) / t moves monotonically; the extremes are therefore
// at these samples and nowhere else. Instants at or before the pull are dropped (DPS undefined).
export function deltaDpsSeries(
	comparison: SeriesComparison,
	extraTimes: number[] = [],
): DeltaDpsSeries {
	const { baselineId, ids, series } = comparison;
	const times = deltaSampleTimes(comparison, extraTimes);
	const baseline = series[baselineId];
	return {
		times,
		series: ids
			.filter((id) => id !== baselineId)
			.map((id) => ({
				id,
				deltaDps: times.map((t) => dpsAt(series[id], t)! - dpsAt(baseline, t)!),
			})),
	};
}

export interface DeltaPctSeries {
	// Ascending, all after the pull.
	times: number[];
	// Per non-baseline configuration, in the given order: deltaPct at each of `times`. A fraction
	// (0.05 = 5%), as in `CutoffRow`, and undefined where the baseline DPS is 0.
	series: { id: string; deltaPct: (number | undefined)[] }[];
}

// deltaPct at the same instants as `deltaDpsSeries`. It equals (Ta - Tb) / Tb, in which t cancels,
// so it is a pure step that holds between events (unlike deltaDps, which follows c / t).
export function deltaPctSeries(
	comparison: SeriesComparison,
	extraTimes: number[] = [],
): DeltaPctSeries {
	const { baselineId, ids, series } = comparison;
	const times = deltaSampleTimes(comparison, extraTimes);
	const baseline = series[baselineId];
	return {
		times,
		series: ids
			.filter((id) => id !== baselineId)
			.map((id) => ({
				id,
				deltaPct: times.map((t) => {
					const baselineDps = dpsAt(baseline, t)!;
					if (baselineDps === 0) return undefined;
					return (dpsAt(series[id], t)! - baselineDps) / baselineDps;
				}),
			})),
	};
}
