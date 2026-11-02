import React, { useMemo, useState } from "react";

import {
	burstWindows,
	compareRotations,
	dpsSamples,
	sampleTimes,
	TimeWindow,
} from "../comparison/compare";
import { GearSetDocument, resolveGear } from "../models/GearSet";
import { RotationDocument } from "../models/Rotation";
import { BurstWindow, ScenarioDocument } from "../models/Scenario";
import { GaugeValue } from "../rules/resourceTracking";
import { SimulationCache } from "../simulation/SimulationManager";
import { RotationResult } from "../simulation/types";
import { formatNumber } from "./format";

// Chart geometry in SVG user units; the SVG scales to the panel width.
const W = 800;
const H = 240;
const PAD = { left: 64, right: 72, top: 16, bottom: 28 };

function niceStep(range: number, targetTicks: number): number {
	const raw = range / targetTicks;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
	return step ?? 10 * magnitude;
}

interface ChartSeries {
	label: string;
	// One value per entry of the chart's `times`.
	values: number[];
	// Stroke color class (rl-series-a, rl-series-b, rl-series-lead).
	className: string;
}

// Lines sampled at `times`, with burst windows shaded, cutoffs dashed and a crosshair tooltip.
function LineChart(props: {
	ariaLabel: string;
	times: number[];
	series: ChartSeries[];
	windows: TimeWindow[];
	cutoffs: number[];
	// Draws a zero line and labels the halves above and below it.
	zero?: { above: string; below: string };
}) {
	const { times, series, windows, cutoffs, zero } = props;
	const [hover, setHover] = useState<number>();
	if (times.length < 2) {
		return <p className="rl-note">Not enough of the fight to chart from this start time.</p>;
	}

	const x0 = times[0];
	const x1 = times[times.length - 1];
	const all = series.flatMap((s) => s.values);
	let yMax = Math.max(...all, ...(zero ? [0] : []));
	let yMin = Math.min(...all, ...(zero ? [0] : []));
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
	for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) yTicks.push(v);

	const point = hover === undefined ? undefined : { t: times[hover], i: hover };

	return <div className="rl-chart">
		{series.length > 1 && <div className="rl-legend">
			{series.map((s) => <span key={s.label}>
				<span className={`rl-swatch ${s.className}`} />
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
				if (t < x0 || t > x1) return setHover(undefined);
				let nearest = 0;
				times.forEach((s, i) => {
					if (Math.abs(s - t) < Math.abs(times[nearest] - t)) nearest = i;
				});
				setHover(nearest);
			}}
		>
			{windows
				.filter((w) => w.end > x0 && w.start < x1)
				.map((w, i) => <rect
					key={i}
					className="rl-chart-window"
					x={x(clampX(w.start))}
					y={PAD.top}
					width={x(clampX(w.end)) - x(clampX(w.start))}
					height={H - PAD.top - PAD.bottom}
				/>)}
			{yTicks.map((v) => <g key={v}>
				<line
					className={zero && v === 0 ? "rl-chart-zero" : "rl-chart-grid"}
					x1={PAD.left}
					x2={W - PAD.right}
					y1={y(v)}
					y2={y(v)}
				/>
				<text className="rl-chart-label" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">
					{formatNumber(v)}
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
					x1={x(c)}
					x2={x(c)}
					y1={PAD.top}
					y2={H - PAD.bottom}
				/>)}
			{zero && <>
				<text className="rl-chart-label" x={PAD.left + 6} y={PAD.top + 12}>
					▲ {zero.above}
				</text>
				<text className="rl-chart-label" x={PAD.left + 6} y={H - PAD.bottom - 6}>
					▼ {zero.below}
				</text>
			</>}
			{series.map((s) => {
				const d = s.values
					.map((v, i) => `${i === 0 ? "M" : "L"}${x(times[i])},${y(v)}`)
					.join("");
				const last = s.values[s.values.length - 1];
				return <g key={s.label}>
					<path className={`rl-chart-line ${s.className}`} d={d} />
					<text className="rl-chart-value" x={W - PAD.right + 6} y={y(last) + 4}>
						{formatNumber(last)}
					</text>
				</g>;
			})}
			{point && <line
				className="rl-chart-crosshair"
				x1={x(point.t)}
				x2={x(point.t)}
				y1={PAD.top}
				y2={H - PAD.bottom}
			/>}
		</svg>
		{point && <div
			className="rl-chart-tooltip"
			style={{
				left: `${(x(point.t) / W) * 100}%`,
				// Flip to the left of the crosshair near the right edge.
				transform: x(point.t) / W > 0.7 ? "translateX(calc(-100% - 8px))" : undefined,
			}}
			role="status"
		>
			<div>
				<b>{formatNumber(point.t)} s</b>
			</div>
			{series.map((s) => <div key={s.label}>
				{s.label}: {formatNumber(s.values[point.i], 1)}
			</div>)}
		</div>}
	</div>;
}

function Gauges(props: { gauges?: GaugeValue[] }) {
	if (!props.gauges) return null;
	return <>
		{props.gauges.map((g) => <div key={g.key} className="rl-note">
			{g.label} {g.amount}
			{g.max <= 5 && `/${g.max}`}
		</div>)}
	</>;
}

// A number input that can be cleared and retyped freely; only valid numbers are committed.
function NumberField(props: { label: string; value: number; onCommit: (value: number) => void }) {
	const [text, setText] = useState(String(props.value));
	const [shown, setShown] = useState(props.value);
	if (props.value !== shown) {
		// Changed from outside (e.g. another edit): show the new value.
		setShown(props.value);
		setText(String(props.value));
	}
	return <input
		type="number"
		aria-label={props.label}
		value={text}
		onChange={(e) => {
			setText(e.target.value);
			const v = Number(e.target.value);
			if (e.target.value.trim() !== "" && Number.isFinite(v)) {
				setShown(v);
				props.onCommit(v);
			}
		}}
	/>;
}

// Editable burst windows; without custom ones, the scenario's merged party buffs are used.
function BurstWindowEditor(props: {
	scenario: ScenarioDocument;
	derived: TimeWindow[];
	onChange: (windows: BurstWindow[] | undefined) => void;
}) {
	const { scenario, derived, onChange } = props;
	const custom = scenario.burstWindows;
	if (!custom) {
		return <div className="rl-compare-controls">
			<span className="rl-note">
				Using the party buff windows ({derived.length}). Define your own to compare other
				stretches, e.g. Serpent's Ire or Reawaken bursts.
			</span>
			<button onClick={() => onChange(derived.map((w) => ({ start: w.start, end: w.end })))}>
				Customize windows
			</button>
		</div>;
	}
	const set = (i: number, patch: Partial<BurstWindow>) =>
		onChange(custom.map((w, j) => (j === i ? { ...w, ...patch } : w)));
	return <div>
		{custom.map((w, i) => <div className="rl-compare-controls rl-window-row" key={i}>
			<input
				aria-label="Window label"
				placeholder="Label"
				value={w.label ?? ""}
				onChange={(e) => set(i, { label: e.target.value || undefined })}
			/>
			<NumberField
				label="Window start"
				value={w.start}
				onCommit={(start) => set(i, { start })}
			/>
			to
			<NumberField label="Window end" value={w.end} onCommit={(end) => set(i, { end })} />s
			<button
				className="rl-remove"
				aria-label="Remove window"
				onClick={() => onChange(custom.filter((_, j) => j !== i))}
			>
				×
			</button>
		</div>)}
		<div className="rl-compare-controls">
			<button
				onClick={() => {
					const lastEnd = custom[custom.length - 1]?.end ?? 0;
					onChange([...custom, { start: lastEnd + 100, end: lastEnd + 120 }]);
				}}
			>
				Add window
			</button>
			<button onClick={() => onChange(undefined)}>Use party buffs instead</button>
		</div>
	</div>;
}

function simulate(
	cache: SimulationCache,
	rotation: RotationDocument,
	scenario: ScenarioDocument,
	gearSets: GearSetDocument[],
): RotationResult | string {
	try {
		return cache.get(rotation, scenario, resolveGear(rotation, gearSets)).result;
	} catch (e) {
		return (e as Error).message;
	}
}

export function ComparisonView(props: {
	rotations: RotationDocument[];
	scenario: ScenarioDocument;
	cache: SimulationCache;
	defaultA: string;
	onScenarioChange: (scenario: ScenarioDocument) => void;
	gearSets: GearSetDocument[];
}) {
	const { rotations, scenario, cache, onScenarioChange, gearSets } = props;
	const [idA, setIdA] = useState(props.defaultA);
	const [idB, setIdB] = useState(
		() => rotations.find((r) => r.id !== props.defaultA)?.id ?? props.defaultA,
	);
	const [extraCutoffs, setExtraCutoffs] = useState<number[]>([]);
	const [cutoffText, setCutoffText] = useState("");
	const [from, setFrom] = useState(10);

	const rotationA = rotations.find((r) => r.id === idA) ?? rotations[0];
	const rotationB = rotations.find((r) => r.id === idB) ?? rotations[0];
	const resultA = useMemo(
		() => simulate(cache, rotationA, scenario, gearSets),
		[cache, rotationA, scenario, gearSets],
	);
	const resultB = useMemo(
		() => simulate(cache, rotationB, scenario, gearSets),
		[cache, rotationB, scenario, gearSets],
	);
	const gearName = (r: RotationDocument) =>
		(gearSets.find((g) => g.id === r.gearSetId)?.name ?? "job defaults") +
		(r.gearOverrides ? " + overrides" : "");

	const ready = typeof resultA !== "string" && typeof resultB !== "string";
	const endTime = ready ? Math.max(resultA.endTime, resultB.endTime) : 0;
	// Custom windows that end before they start (mid-edit) are skipped until fixed.
	const windows = useMemo(
		() =>
			scenario.burstWindows?.filter((w) => w.end > w.start) ??
			(ready ? burstWindows(resultA) : []),
		[scenario.burstWindows, ready, resultA],
	);
	const comparison = useMemo(() => {
		if (!ready) return undefined;
		const cutoffs = [...new Set([...extraCutoffs, endTime])].sort((p, q) => p - q);
		return compareRotations(resultA, resultB, cutoffs, windows);
	}, [ready, resultA, resultB, extraCutoffs, endTime, windows]);

	const nameA = `A: ${rotationA.name || "(unnamed)"}`;
	const nameB = `B: ${rotationB.name || "(unnamed)"}`;
	const unit = comparison?.metric === "potency" ? "Potency" : "Damage";
	const perSecond = comparison?.metric === "potency" ? "PPS" : "DPS";

	const charts = useMemo(() => {
		if (!comparison) return undefined;
		const times = sampleTimes(from, endTime);
		const dpsA = dpsSamples(comparison.a, times);
		const dpsB = dpsSamples(comparison.b, times);
		return { times, dpsA, dpsB, lead: dpsA.map((v, i) => v - dpsB[i]) };
	}, [comparison, from, endTime]);

	const picker = (label: string, value: string, onChange: (id: string) => void) => <label>
		{label}{" "}
		<select
			aria-label={`Rotation ${label}`}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{rotations.map((r) => <option key={r.id} value={r.id}>
				{r.name || "(unnamed)"}
			</option>)}
		</select>
	</label>;

	return <section className="rl-compare" aria-label="Comparison">
		<div className="rl-compare-controls">
			{picker("A", rotationA.id, setIdA)}
			{picker("B", rotationB.id, setIdB)}
			<label>
				Charts from{" "}
				<input
					type="number"
					min={0}
					step={5}
					aria-label="Charts from seconds"
					value={from}
					onChange={(e) => {
						const t = Number(e.target.value);
						if (Number.isFinite(t) && t >= 0) setFrom(t);
					}}
					style={{ width: 64 }}
				/>{" "}
				s
			</label>
			<span className="rl-note">
				Scenario “{scenario.name}” · gear A: {gearName(rotationA)} · gear B:{" "}
				{gearName(rotationB)}
			</span>
		</div>

		{typeof resultA === "string" && <div className="rl-banner">
			A cannot be simulated: {resultA}
		</div>}
		{typeof resultB === "string" && <div className="rl-banner">
			B cannot be simulated: {resultB}
		</div>}
		{rotations.length < 2 && <div className="rl-banner">
			Create or duplicate a second rotation to compare against.
		</div>}

		{comparison && charts && <>
			<h2>
				Running {perSecond}
				{comparison.metric === "potency" && " (no damage model for this job or level)"}
			</h2>
			<LineChart
				ariaLabel={`Running ${perSecond} of both rotations over time`}
				times={charts.times}
				series={[
					{ label: nameA, values: charts.dpsA, className: "rl-series-a" },
					{ label: nameB, values: charts.dpsB, className: "rl-series-b" },
				]}
				windows={windows}
				cutoffs={comparison.cutoffs.map((c) => c.time)}
			/>

			<h2>{perSecond} lead (A − B)</h2>
			<LineChart
				ariaLabel={`${perSecond} lead of ${nameA} over ${nameB} over time`}
				times={charts.times}
				series={[{ label: "A − B", values: charts.lead, className: "rl-series-lead" }]}
				windows={windows}
				cutoffs={comparison.cutoffs.map((c) => c.time)}
				zero={{ above: `${nameA} ahead`, below: `${nameB} ahead` }}
			/>
			<p className="rl-note">
				{perSecond} = total so far ÷ time since the pull, sampled every second. Shaded:
				burst windows. Dashed: cutoffs.
			</p>

			<h2>At cutoffs</h2>
			<div className="rl-compare-controls">
				<input
					type="number"
					min={0}
					step={1}
					placeholder="Cutoff (s)"
					aria-label="Cutoff seconds"
					value={cutoffText}
					onChange={(e) => setCutoffText(e.target.value)}
				/>
				<button
					onClick={() => {
						const t = Number(cutoffText);
						if (cutoffText.trim() !== "" && Number.isFinite(t) && t > 0) {
							setExtraCutoffs((cs) => [...new Set([...cs, t])]);
							setCutoffText("");
						}
					}}
				>
					Add cutoff
				</button>
			</div>
			<table className="rl-table rl-compare-table">
				<thead>
					<tr>
						<th className="rl-num">Cutoff</th>
						<th className="rl-num">{perSecond} A</th>
						<th className="rl-num">{perSecond} B</th>
						<th className="rl-num">A − B</th>
						<th className="rl-num">{unit} A</th>
						<th className="rl-num">{unit} B</th>
						<th>Gauges A</th>
						<th>Gauges B</th>
						<th aria-label="Remove" />
					</tr>
				</thead>
				<tbody>
					{comparison.cutoffs.map((c) => <tr key={c.time} data-testid="cutoff-row">
						<td className="rl-num">{formatNumber(c.time, 2)} s</td>
						<td className="rl-num">{formatNumber(c.dpsA, 1)}</td>
						<td className="rl-num">{formatNumber(c.dpsB, 1)}</td>
						<td className="rl-num">
							{c.dpsA !== undefined &&
								c.dpsB !== undefined &&
								formatNumber(c.dpsA - c.dpsB, 1)}
						</td>
						<td className="rl-num">{formatNumber(c.a)}</td>
						<td className="rl-num">{formatNumber(c.b)}</td>
						<td>
							<Gauges gauges={c.gaugesA} />
						</td>
						<td>
							<Gauges gauges={c.gaugesB} />
						</td>
						<td>
							{extraCutoffs.includes(c.time) && <button
								className="rl-remove"
								aria-label="Remove cutoff"
								onClick={() =>
									setExtraCutoffs((cs) => cs.filter((t) => t !== c.time))
								}
							>
								×
							</button>}
						</td>
					</tr>)}
				</tbody>
			</table>
			<p className="rl-note">Gauges as left by the last action pressed before the cutoff.</p>

			<h2>Lead changes</h2>
			{comparison.leadChanges.length === 0 ? (
				<p className="rl-note">Neither rotation is ever ahead.</p>
			) : (
				<ul className="rl-compare-list">
					{comparison.leadChanges.map((c, i) => <li key={i}>
						{formatNumber(c.time, 2)} s: {c.leader === "a" ? nameA : nameB}{" "}
						{i === 0 ? "pulls ahead" : "overtakes"}
					</li>)}
				</ul>
			)}

			<h2>Burst windows</h2>
			<BurstWindowEditor
				scenario={scenario}
				derived={burstWindows(resultA as RotationResult)}
				onChange={(burst) => {
					const next = { ...scenario, updatedAt: new Date().toISOString() };
					if (burst === undefined) delete next.burstWindows;
					else next.burstWindows = burst;
					onScenarioChange(next);
				}}
			/>
			{comparison.windows.length > 0 && <table className="rl-table rl-compare-table">
				<thead>
					<tr>
						<th>Window</th>
						<th className="rl-num">{unit} A</th>
						<th className="rl-num">{unit} B</th>
						<th className="rl-num">A − B</th>
					</tr>
				</thead>
				<tbody>
					{comparison.windows.map((w, i) => <tr key={i} data-testid="window-row">
						<td>
							{w.label ? `${w.label}: ` : ""}
							{formatNumber(w.start, 2)}–{formatNumber(w.end, 2)} s
						</td>
						<td className="rl-num">{formatNumber(w.a)}</td>
						<td className="rl-num">{formatNumber(w.b)}</td>
						<td className="rl-num">{formatNumber(w.a - w.b)}</td>
					</tr>)}
				</tbody>
			</table>}
		</>}
	</section>;
}
