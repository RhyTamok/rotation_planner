import React, { useId, useState } from "react";

import { TimeWindow } from "../../comparison/compare";
import { CurvePoint } from "../../comparison/curves";
import { DowntimeWindow } from "../../simulation/types";
import { formatNumber } from "../format";

// Chart geometry in SVG user units; the SVG scales to the panel width.
const W = 800;
const H = 240;
const PAD = { left: 64, right: 92, top: 16, bottom: 28 };
// The smallest vertical distance between two end-of-line labels.
const LABEL_GAP = 14;

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

// Lines over time, with burst windows shaded, downtime hatched, cutoffs marked and a crosshair
// tooltip. `from` and `to` bound the time shown.
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
	format: (value: number) => string;
	formatExact: (value: number | undefined) => string;
}) {
	const { from: x0, to: x1, series, windows, downtime, cutoffs, zeroLabel } = props;
	const [hover, setHover] = useState<number>();
	const hatchId = `rl-hatch-${useId().replace(/\W/g, "")}`;
	if (x1 <= x0) {
		return <p className="rl-note">Not enough of the fight to chart from this start time.</p>;
	}

	const all = series.flatMap((s) =>
		s.points.flatMap((p) => (p.value === undefined ? [] : [p.value])),
	);
	if (zeroLabel !== undefined) all.push(0);
	if (all.length === 0) return <p className="rl-note">No values to chart.</p>;
	let yMax = all.reduce((m, v) => Math.max(m, v), -Infinity);
	let yMin = all.reduce((m, v) => Math.min(m, v), Infinity);
	if (yMax === yMin) {
		yMax += 1;
		yMin -= 1;
	}
	const x = (t: number) => PAD.left + ((t - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
	const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
	const clampX = (t: number) => Math.min(x1, Math.max(x0, t));

	const xStep = niceStep(x1 - x0, 8);
	const xTicks: number[] = [];
	for (let t = Math.ceil(x0 / xStep) * xStep; t <= x1 + 1e-9; t += xStep) xTicks.push(t);
	const yStep = niceStep(yMax - yMin, 4);
	const yTicks: number[] = [];
	for (let k = Math.ceil(yMin / yStep); k * yStep <= yMax + 1e-9; k++) yTicks.push(k * yStep);

	const ends = series.map((s) => {
		for (let i = s.points.length - 1; i >= 0; i--) {
			if (s.points[i].value !== undefined) return s.points[i].value;
		}
		return undefined;
	});
	const labelled = series.flatMap((s, i) => {
		const end = ends[i];
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

	return <div className="rl-chart">
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
		<svg
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={props.ariaLabel}
			onMouseLeave={() => setHover(undefined)}
			onMouseMove={(e) => {
				const box = e.currentTarget.getBoundingClientRect();
				const px = ((e.clientX - box.left) / box.width) * W;
				const t = x0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (x1 - x0);
				setHover(t < x0 || t > x1 ? undefined : t);
			}}
		>
			<defs>
				<pattern
					id={hatchId}
					patternUnits="userSpaceOnUse"
					width={8}
					height={8}
					patternTransform="rotate(45)"
				>
					<line className="rl-chart-hatch" x1={0} x2={0} y1={0} y2={8} />
				</pattern>
			</defs>
			{windows.filter(inView).map((w, i) => band(w, `window-${i}`, "rl-chart-window"))}
			{downtime
				.filter(inView)
				.map((w, i) => band(w, `downtime-${i}`, "rl-chart-downtime", `url(#${hatchId})`))}
			{yTicks.map((v) => <g key={v}>
				<line
					className="rl-chart-grid"
					x1={PAD.left}
					x2={W - PAD.right}
					y1={y(v)}
					y2={y(v)}
				/>
				<text className="rl-chart-label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
					{props.format(v)}
				</text>
			</g>)}
			{xTicks.map((t) => <text
				key={t}
				className="rl-chart-label"
				x={x(t)}
				y={H - 8}
				textAnchor="middle"
			>
				{formatNumber(t)} s
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
			{series.map((s) => <path
				key={s.letter}
				className={`rl-chart-line ${s.seriesClass}`}
				d={linePath(s.points, x, y)}
			/>)}
			{labelled.map((l, i) => <text
				key={l.letter}
				className="rl-chart-value"
				x={W - PAD.right + 6}
				y={labelY[i] + 4}
			>
				{l.letter} {props.format(l.end)}
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
				left: `${(x(hover) / W) * 100}%`,
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
		</div>}
	</div>;
}
