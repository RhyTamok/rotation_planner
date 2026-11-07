import { CurvePoint } from "../../comparison/curves";

// The part of a chart's time axis on show, for zooming and dragging. Pure, so the maths is tested
// without a browser.

export interface TimeRange {
	start: number;
	end: number;
}

// Zooming stops here: below half a second a chart shows hardly more than one hit.
export const MIN_SPAN = 0.5;

const span = (r: TimeRange) => r.end - r.start;

// `range` moved inside `domain` and no narrower than MIN_SPAN (or the domain, if that is narrower).
export function clampRange(range: TimeRange, domain: TimeRange): TimeRange {
	const width = Math.min(span(domain), Math.max(span(range), Math.min(MIN_SPAN, span(domain))));
	const start = Math.min(Math.max(range.start, domain.start), domain.end - width);
	return { start, end: start + width };
}

// Scales the span by `factor` (below 1 zooms in) around `center`, which stays where it is on screen.
export function zoomRange(
	range: TimeRange,
	domain: TimeRange,
	center: number,
	factor: number,
): TimeRange {
	return clampRange(
		{
			start: center - (center - range.start) * factor,
			end: center + (range.end - center) * factor,
		},
		domain,
	);
}

export function panRange(range: TimeRange, domain: TimeRange, by: number): TimeRange {
	return clampRange({ start: range.start + by, end: range.end + by }, domain);
}

export function isWholeDomain(range: TimeRange, domain: TimeRange): boolean {
	return range.start <= domain.start && range.end >= domain.end;
}

// The line's value at `t`, between the points around it. Where a jump puts two points at one time,
// the first wins. Undefined outside the points or across a gap.
export function valueOnLine(points: CurvePoint[], t: number): number | undefined {
	for (let i = 0; i + 1 < points.length; i++) {
		const [a, b] = [points[i], points[i + 1]];
		if (a.t <= t && t <= b.t) {
			if (a.value === undefined || b.value === undefined) return undefined;
			return b.t === a.t
				? a.value
				: a.value + ((b.value - a.value) * (t - a.t)) / (b.t - a.t);
		}
	}
	return points.length === 1 && points[0].t === t ? points[0].value : undefined;
}

// What the y axis must fit for this range: every point inside it, and the line where it crosses the
// edges. Rescaling to just this is what makes small differences readable once zoomed in.
export function valuesInRange(points: CurvePoint[], range: TimeRange): number[] {
	const values: number[] = [];
	for (const p of points) {
		if (p.t >= range.start && p.t <= range.end && p.value !== undefined) values.push(p.value);
	}
	for (const edge of [range.start, range.end]) {
		const v = valueOnLine(points, edge);
		if (v !== undefined) values.push(v);
	}
	return values;
}
