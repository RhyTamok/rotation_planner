import { SeriesComparison } from "./baseline";
import { TimeWindow, totalBetween } from "./compare";

// Damage per burst window for N configurations against the baseline. Windows are (start, end],
// like cutoffs (spec Q1), so adjacent windows never count a hit twice.

export interface BurstRow {
	id: string;
	total: number;
	// total minus the baseline's total in this window. Exactly 0 for the baseline.
	deltaTotal: number;
}

export interface BurstWindowRows extends TimeWindow {
	// In the order the configurations were given.
	rows: BurstRow[];
}

export function burstTable(comparison: SeriesComparison, windows: TimeWindow[]): BurstWindowRows[] {
	const { ids, series, baselineId } = comparison;
	return windows.map((w) => {
		const baseline = totalBetween(series[baselineId], w.start, w.end);
		return {
			...w,
			rows: ids.map((id) => {
				const total = totalBetween(series[id], w.start, w.end);
				return { id, total, deltaTotal: id === baselineId ? 0 : total - baseline };
			}),
		};
	});
}
