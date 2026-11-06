import { CumulativeSeries, TIME_TOLERANCE, totalAt } from "./compare";
import { SeriesComparison } from "./baseline";

// Chart lines over the running totals. Totals only change when a hit lands, so between two hits
// DPS and deltaDps follow c / t and deltaPct holds still, and each hit is a vertical jump. A line
// therefore needs the value just before each jump as well as the value after it: sampling only
// after the jumps would draw false straight lines and miss the lows between hits.

export interface CurvePoint {
	t: number;
	// Undefined where the value does not exist (deltaPct while the baseline total is 0).
	value: number | undefined;
}

// DPS shoots towards infinity at the pull, so no line starts before this many seconds.
export const FIRST_CURVE_TIME = 1;

export function curveStart(from: number): number {
	return Math.max(from, FIRST_CURVE_TIME);
}

// Points per chart: a piece longer than 1/200 of the shown time is subdivided so that its curve
// stays smooth. In practice that means gaps such as downtime; pieces between hits are a few pixels.
const SUBDIVISIONS = 200;

function curve(
	series: CumulativeSeries[],
	from: number,
	to: number,
	value: (totals: number[], t: number) => number | undefined,
): CurvePoint[] {
	const start = curveStart(from);
	if (start >= to) return [];
	const landings = series
		.flatMap((s) => s.times)
		.filter((t) => t > start + TIME_TOLERANCE && t < to - TIME_TOLERANCE);
	const breaks = [start, ...new Set(landings.sort((a, b) => a - b)), to];
	const maxStep = (to - start) / SUBDIVISIONS;

	const points: CurvePoint[] = [];
	for (let i = 0; i + 1 < breaks.length; i++) {
		const [t1, t2] = [breaks[i], breaks[i + 1]];
		const totals = series.map((s) => totalAt(s, t1));
		const steps = Math.ceil((t2 - t1) / maxStep);
		for (let j = 0; j <= steps; j++) {
			// The piece's last point keeps its own totals: this is the value before the next jump.
			const t = j === steps ? t2 : t1 + ((t2 - t1) * j) / steps;
			points.push({ t, value: value(totals, t) });
		}
	}
	// A hit landing exactly at the end counts, as it does in the cutoff table.
	points.push({
		t: to,
		value: value(
			series.map((s) => totalAt(s, to)),
			to,
		),
	});
	return points;
}

export function runningDpsCurve(series: CumulativeSeries, from: number, to: number): CurvePoint[] {
	return curve([series], from, to, ([total], t) => total / t);
}

export function deltaDpsCurve(
	comparison: SeriesComparison,
	id: string,
	from: number,
	to: number,
): CurvePoint[] {
	const { series, baselineId } = comparison;
	return curve(
		[series[id], series[baselineId]],
		from,
		to,
		([own, baseline], t) => (own - baseline) / t,
	);
}

// A fraction (0.05 = 5%), as everywhere in the maths layer.
export function deltaPctCurve(
	comparison: SeriesComparison,
	id: string,
	from: number,
	to: number,
): CurvePoint[] {
	const { series, baselineId } = comparison;
	return curve([series[id], series[baselineId]], from, to, ([own, baseline]) =>
		baseline === 0 ? undefined : (own - baseline) / baseline,
	);
}
