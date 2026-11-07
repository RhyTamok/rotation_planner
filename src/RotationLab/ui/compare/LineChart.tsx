import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { TimeWindow } from "../../comparison/compare";
import { CurvePoint } from "../../comparison/curves";
import { DowntimeWindow } from "../../simulation/types";
import { formatInterval, formatNumber } from "../format";
import {
	clampRange,
	isWholeDomain,
	panRange,
	TimeRange,
	valueOnLine,
	valuesInRange,
	zoomRange,
} from "./viewRange";

// The SVG is drawn at the plot's real size in pixels (RotationLab.css sets that size), so text and
// lines stay their size however wide the panel is. Without a layout (tests), this size is used.
const FALLBACK_SIZE = { width: 800, height: 240 };
const PAD = { left: 64, right: 92, top: 16, bottom: 28 };
// The smallest vertical distance between two end-of-line labels.
const LABEL_GAP = 14;
// One wheel notch, and one press of a zoom button.
const WHEEL_ZOOM = 1.25;
const BUTTON_ZOOM = 1.5;

function niceStep(range: number, targetTicks: number): number {
	const raw = range / targetTicks;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
	return step ?? 10 * magnitude;
}

export interface ChartSeries {
	// Identifies the series; also starts its end-of-line label, so identity never rests on colour.
	letter: string;
	label: string;
	seriesClass: string;
	points: CurvePoint[];
	// The exact value at any time, for the tooltip.
	valueAt: (t: number) => number | undefined;
}

// An SVG path through the points; undefined values leave a gap.
function linePath(points: CurvePoint[], x: (t: number) => number, y: (v: number) => number) {
	let d = "";
	let drawing = false;
	for (const { t, value } of points) {
		if (value === undefined) {
			drawing = false;
			continue;
		}
		d += `${drawing ? "L" : "M"}${x(t)},${y(value)}`;
		drawing = true;
	}
	return d;
}

// End-of-line labels pushed apart where they would overlap, keeping their order.
function labelPositions(wanted: number[]): number[] {
	const order = wanted.map((_, i) => i).sort((a, b) => wanted[a] - wanted[b]);
	const placed = [...wanted];
	order.forEach((i, rank) => {
		if (rank > 0) placed[i] = Math.max(wanted[i], placed[order[rank - 1]] + LABEL_GAP);
	});
	return placed;
}

// The element's size in pixels, following resizes.
function useSize(ref: React.RefObject<HTMLElement | null>, present: boolean) {
	const [size, setSize] = useState(FALLBACK_SIZE);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const box = el.getBoundingClientRect();
			if (box.width > 0 && box.height > 0) {
				setSize({ width: Math.round(box.width), height: Math.round(box.height) });
			}
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref, present]);
	return size;
}

export interface ChartAnnotation {
	time: number;
	letter: string;
	kind: "enter" | "exit";
}

// Lines over time, with burst windows shaded, downtime hatched, cutoffs marked and a crosshair
// tooltip. `from` and `to` bound the time available. The wheel zooms around the pointer, dragging
// pans, a double click shows everything again, and the y axis fits what is on show.
export function LineChart(props: {
	ariaLabel: string;
	from: number;
	to: number;
	series: ChartSeries[];
	windows: TimeWindow[];
	downtime: DowntimeWindow[];
	cutoffs: number[];
	// Draws a dashed zero line with this label: the baseline of a difference chart.
	zeroLabel?: string;
	// Axis and end-of-line labels, with enough decimals to tell neighbouring ticks apart.
	format: (value: number, decimals: number) => string;
	formatExact: (value: number | undefined) => string;
	// A region to outline: local cutoff sensitivity.
	highlight?: { start: number; end: number };
	// Marks along the top edge: entries joining or leaving the competitive set.
	annotations?: ChartAnnotation[];
	// A last tooltip line about the instant under the pointer.
	footerAt?: (t: number) => string;
}) {
	const { series, windows, downtime, cutoffs, zeroLabel } = props;
	const domain: TimeRange = { start: props.from, end: props.to };
	const hasDomain = domain.end > domain.start;
	const [hover, setHover] = useState<number>();
	const [view, setView] = useState<TimeRange>();
	const plot = useRef<HTMLDivElement>(null);
	const drag = useRef<{ clientX: number; range: TimeRange }>(undefined);
	const id = useId().replace(/\W/g, "");
	const { width: W, height: H } = useSize(plot, hasDomain);

	// The range on show. A stored zoom stays within the domain when the fight's length changes.
	const shown = view && hasDomain ? clampRange(view, domain) : domain;
	const { start: x0, end: x1 } = shown;
	const plotWidth = W - PAD.left - PAD.right;
	// The time under a pointer position, from the plot's own box.
	const timeAt = (clientX: number, box: DOMRect) => {
		const px = box.width > 0 ? clientX - box.left : W / 2;
		return x0 + ((px - PAD.left) / plotWidth) * (x1 - x0);
	};

	// The wheel listener must not be passive, or the page would scroll while zooming. It reads the
	// latest range through a ref, because it is attached once.
	const latest = useRef({ shown, domain, timeAt });
	latest.current = { shown, domain, timeAt };
	useEffect(() => {
		const el = plot.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const { shown, domain, timeAt } = latest.current;
			const center = Math.min(
				shown.end,
				Math.max(shown.start, timeAt(e.clientX, el.getBoundingClientRect())),
			);
			setView(zoomRange(shown, domain, center, e.deltaY < 0 ? 1 / WHEEL_ZOOM : WHEEL_ZOOM));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [hasDomain]);

	if (!hasDomain) {
		return <p className="rl-note">Not enough of the fight to chart from this start time.</p>;
	}

	const all = series.flatMap((s) => valuesInRange(s.points, shown));
	if (zeroLabel !== undefined) all.push(0);
	if (all.length === 0) return <p className="rl-note">No values to chart.</p>;
	let yMax = all.reduce((m, v) => Math.max(m, v), -Infinity);
	let yMin = all.reduce((m, v) => Math.min(m, v), Infinity);
	if (yMax === yMin) {
		yMax += 1;
		yMin -= 1;
	}
	const x = (t: number) => PAD.left + ((t - x0) / (x1 - x0)) * plotWidth;
	const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
	const clampX = (t: number) => Math.min(x1, Math.max(x0, t));

	const xStep = niceStep(x1 - x0, Math.max(4, Math.round(plotWidth / 110)));
	const xTicks: number[] = [];
	for (let k = Math.ceil(x0 / xStep); k * xStep <= x1 + 1e-9; k++) xTicks.push(k * xStep);
	const yStep = niceStep(yMax - yMin, Math.max(3, Math.round(H / 70)));
	const yTicks: number[] = [];
	for (let k = Math.ceil(yMin / yStep); k * yStep <= yMax + 1e-9; k++) yTicks.push(k * yStep);
	const decimals = Math.max(0, -Math.floor(Math.log10(xStep)));
	// Zoomed in on a small difference, ticks can be 0.5 or 0.02 apart.
	const yDecimals = Math.max(0, -Math.floor(Math.log10(yStep)));

	// Each line's value at the right edge of what is on show.
	const labelled = series.flatMap((s) => {
		const end = valueOnLine(s.points, x1);
		return end === undefined ? [] : [{ letter: s.letter, end }];
	});
	const labelY = labelPositions(labelled.map((l) => y(l.end)));

	const band = (
		w: { start: number; end: number },
		key: string,
		className: string,
		fill?: string,
	) => <rect
		key={key}
		className={className}
		fill={fill}
		x={x(clampX(w.start))}
		y={PAD.top}
		width={x(clampX(w.end)) - x(clampX(w.start))}
		height={H - PAD.top - PAD.bottom}
	/>;
	const inView = (w: { start: number; end: number }) => w.end > x0 && w.start < x1;
	const zoomed = !isWholeDomain(shown, domain);
	const zoomBy = (factor: number) =>
		setView(zoomRange(shown, domain, (shown.start + shown.end) / 2, factor));

	return <div className="rl-chart">
		<div className="rl-chart-toolbar" role="group" aria-label={`${props.ariaLabel}: zoom`}>
			{series.length > 1 && <div className="rl-legend">
				{series.map((s) => <span key={s.letter}>
					<svg className="rl-swatch" width={28} height={6} aria-hidden="true">
						<line
							className={`rl-chart-line ${s.seriesClass}`}
							x1={0}
							x2={28}
							y1={3}
							y2={3}
						/>
					</svg>
					{s.label}
				</span>)}
			</div>}
			<span className="rl-chart-zoom">
				{zoomed && <span className="rl-note" data-testid="chart-range">
					Showing {formatInterval(x0, x1)}
				</span>}
				<button aria-label="Zoom in" onClick={() => zoomBy(1 / BUTTON_ZOOM)}>
					+
				</button>
				<button
					aria-label="Zoom out"
					disabled={!zoomed}
					onClick={() => zoomBy(BUTTON_ZOOM)}
				>
					−
				</button>
				<button disabled={!zoomed} onClick={() => setView(undefined)}>
					Show all
				</button>
			</span>
		</div>
		<div className="rl-chart-plot" ref={plot}>
			<svg
				width={W}
				height={H}
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label={props.ariaLabel}
				className={drag.current ? "rl-dragging" : undefined}
				onPointerLeave={() => setHover(undefined)}
				onPointerDown={(e) => {
					if (e.button !== 0) return;
					drag.current = { clientX: e.clientX, range: shown };
					e.currentTarget.setPointerCapture?.(e.pointerId);
				}}
				onPointerUp={() => {
					drag.current = undefined;
				}}
				onPointerMove={(e) => {
					const box = e.currentTarget.getBoundingClientRect();
					const start = drag.current;
					if (start) {
						const seconds = ((start.clientX - e.clientX) / plotWidth) * (x1 - x0);
						setView(panRange(start.range, domain, seconds));
						setHover(undefined);
						return;
					}
					const t = timeAt(e.clientX, box);
					setHover(t < x0 || t > x1 ? undefined : t);
				}}
				onDoubleClick={() => setView(undefined)}
			>
				<defs>
					<pattern
						id={`rl-hatch-${id}`}
						patternUnits="userSpaceOnUse"
						width={8}
						height={8}
						patternTransform="rotate(45)"
					>
						<line className="rl-chart-hatch" x1={0} x2={0} y1={0} y2={8} />
					</pattern>
					<clipPath id={`rl-clip-${id}`}>
						<rect x={PAD.left} y={0} width={plotWidth} height={H - PAD.bottom} />
					</clipPath>
				</defs>
				{windows.filter(inView).map((w, i) => band(w, `window-${i}`, "rl-chart-window"))}
				{downtime
					.filter(inView)
					.map((w, i) =>
						band(w, `downtime-${i}`, "rl-chart-downtime", `url(#rl-hatch-${id})`),
					)}
				{props.highlight &&
					inView(props.highlight) &&
					band(props.highlight, "highlight", "rl-chart-highlight")}
				{yTicks.map((v) => <g key={v}>
					<line
						className="rl-chart-grid"
						x1={PAD.left}
						x2={W - PAD.right}
						y1={y(v)}
						y2={y(v)}
					/>
					<text className="rl-chart-label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
						{props.format(v, yDecimals)}
					</text>
				</g>)}
				{xTicks.map((t) => <text
					key={t}
					className="rl-chart-label"
					data-testid="chart-x-tick"
					x={x(t)}
					y={H - 8}
					textAnchor="middle"
				>
					{formatNumber(t, decimals)} s
				</text>)}
				{cutoffs
					.filter((c) => c >= x0 && c <= x1)
					.map((c) => <line
						key={c}
						className="rl-chart-cutoff"
						data-testid="chart-cutoff"
						x1={x(c)}
						x2={x(c)}
						y1={PAD.top}
						y2={H - PAD.bottom}
					/>)}
				{zeroLabel !== undefined && <>
					<line
						className="rl-chart-zero"
						x1={PAD.left}
						x2={W - PAD.right}
						y1={y(0)}
						y2={y(0)}
					/>
					<text className="rl-chart-label" x={PAD.left + 6} y={y(0) - 4}>
						{zeroLabel}
					</text>
				</>}
				<g clipPath={`url(#rl-clip-${id})`}>
					{series.map((s) => <path
						key={s.letter}
						className={`rl-chart-line ${s.seriesClass}`}
						d={linePath(s.points, x, y)}
					/>)}
				</g>
				{props.annotations
					?.filter((a) => a.time >= x0 && a.time <= x1)
					.map((a, i) => <text
						key={`${a.time}-${a.letter}`}
						className="rl-chart-annotation"
						data-testid="chart-annotation"
						x={x(a.time)}
						// Three staggered rows, so that neighbours stay readable.
						y={PAD.top + 10 + (i % 3) * 12}
						textAnchor="middle"
					>
						{a.kind === "enter" ? "▲" : "▼"}
						{a.letter}
					</text>)}
				{labelled.map((l, i) => <text
					key={l.letter}
					className="rl-chart-value"
					x={W - PAD.right + 6}
					y={labelY[i] + 4}
				>
					{l.letter} {props.format(l.end, yDecimals)}
				</text>)}
				{hover !== undefined && <line
					className="rl-chart-crosshair"
					x1={x(hover)}
					x2={x(hover)}
					y1={PAD.top}
					y2={H - PAD.bottom}
				/>}
			</svg>
			{hover !== undefined && <div
				className="rl-chart-tooltip"
				style={{
					left: `${x(hover)}px`,
					// Flip to the left of the crosshair near the right edge.
					transform: x(hover) / W > 0.7 ? "translateX(calc(-100% - 8px))" : undefined,
				}}
				role="status"
			>
				<div>
					<b>{formatNumber(hover, 2)} s</b>
				</div>
				{series.map((s) => <div key={s.letter}>
					{s.label}: {props.formatExact(s.valueAt(hover))}
				</div>)}
				{props.footerAt && <div>{props.footerAt(hover)}</div>}
			</div>}
		</div>
		<p className="rl-note rl-chart-hint">
			Wheel over the chart to zoom, drag to move, double-click to show everything.
		</p>
	</div>;
}
