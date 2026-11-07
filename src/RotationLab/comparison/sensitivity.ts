import { SeriesComparison } from "./baseline";
import { IntervalAnalysis, intervalAnalysis } from "./competitive";
import { FIRST_CURVE_TIME } from "./curves";

// Evaluation intervals and local cutoff sensitivity (design spec 4.5; roadmap M3b). Sensitivity asks
// what changes if the kill comes a little earlier or later. It does not shift downtime or the
// rotation, and it never extrapolates past what was simulated.

export interface EffectiveInterval {
	start: number;
	end: number;
	clampedStart: boolean;
	clampedEnd: boolean;
}

// The part of [start, end] the fight covers, from the first second (where DPS starts to mean
// something, as on the charts) to its end. Undefined when no time is left.
export function effectiveInterval(
	start: number,
	end: number,
	endTime: number,
): EffectiveInterval | undefined {
	const from = Math.max(start, FIRST_CURVE_TIME);
	const to = Math.min(end, endTime);
	if (!(to > from)) return undefined;
	return { start: from, end: to, clampedStart: from !== start, clampedEnd: to !== end };
}

export interface EntrySensitivity {
	id: string;
	// Competitive at every instant of the interval, both ends included.
	alwaysCompetitive: boolean;
	// Lowest and highest deltaDps against the baseline over the interval. Exactly 0 for the baseline.
	lowestDeltaDps: number;
	highestDeltaDps: number;
	maxRegretDps: number;
	maxRegretFraction?: number;
}

export interface LocalSensitivity {
	interval: EffectiveInterval;
	entries: EntrySensitivity[];
}

function deltaRange(analysis: IntervalAnalysis, id: string, baselineId: string): [number, number] {
	let lowest = Infinity;
	let highest = -Infinity;
	for (const { start, end, totals } of analysis.pieces) {
		const gap = totals[id] - totals[baselineId];
		// gap / t is monotonic within a piece, so its extremes are at the piece's two ends. The
		// value at `end` is the one just before the next hit, which a sample after each hit misses.
		lowest = Math.min(lowest, gap / start, gap / end);
		highest = Math.max(highest, gap / start, gap / end);
	}
	return [lowest, highest];
}

// Undefined when T ± δ lies wholly outside the simulated fight.
export function localSensitivity(
	comparison: SeriesComparison,
	time: number,
	delta: number,
	endTime: number,
	epsilonPct: number,
): LocalSensitivity | undefined {
	const interval = effectiveInterval(time - delta, time + delta, endTime);
	if (!interval) return undefined;
	const { series, ids, baselineId } = comparison;
	const analysis = intervalAnalysis(series, ids, interval.start, interval.end, epsilonPct);
	return {
		interval,
		entries: analysis.entries.map(({ id, maxRegretDps, maxRegretFraction }) => {
			const [lowestDeltaDps, highestDeltaDps] = deltaRange(analysis, id, baselineId);
			return {
				id,
				alwaysCompetitive: analysis.pieces.every((p) => p.competitive.includes(id)),
				lowestDeltaDps,
				highestDeltaDps,
				maxRegretDps,
				maxRegretFraction,
			};
		}),
	};
}
