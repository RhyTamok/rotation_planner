import React, { useMemo, useState } from "react";

import {
	compareRotations,
	differenceSeries,
	RotationComparison,
	totalAt,
} from "../comparison/compare";
import { RotationDocument } from "../models/Rotation";
import { ScenarioDocument } from "../models/Scenario";
import { SimulationCache } from "../simulation/SimulationManager";
import { RotationResult } from "../simulation/types";
import { formatNumber } from "./format";

// Chart geometry in SVG user units; the SVG scales to the panel width.
const W = 800;
const H = 260;
const PAD = { left: 64, right: 16, top: 24, bottom: 28 };

function niceStep(range: number, targetTicks: number): number {
	const raw = range / targetTicks;
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
	return step ?? 10 * magnitude;
}

// A − B over time as a step line, with burst windows shaded, cutoffs marked and a crosshair.
function LeadChart(props: {
	comparison: RotationComparison;
	nameA: string;
	nameB: string;
	endTime: number;
}) {
	const { comparison, nameA, nameB, endTime } = props;
	const [hoverT, setHoverT] = useState<number>();
	const { times, diffs } = useMemo(
		() => differenceSeries(comparison.a, comparison.b),
		[comparison],
	);

	const xMax = Math.max(endTime, 1);
	const yMax = Math.max(0, ...diffs);
	const yMin = Math.min(0, ...diffs);
	const ySpan = yMax - yMin || 1;
	const x = (t: number) => PAD.left + (t / xMax) * (W - PAD.left - PAD.right);
	const y = (d: number) => PAD.top + ((yMax - d) / ySpan) * (H - PAD.top - PAD.bottom);

	// Step-after path from 0 s (no lead before the first hit) to the end.
	let path = `M${x(0)},${y(0)}`;
	let last = 0;
	times.forEach((t, i) => {
		if (t < 0) return;
		path += `H${x(t)}V${y(diffs[i])}`;
		last = diffs[i];
	});
	path += `H${x(xMax)}`;

	const xStep = niceStep(xMax, 8);
	const xTicks: number[] = [];
	for (let t = 0; t <= xMax + 1e-9; t += xStep) xTicks.push(t);
	const yTicks = [...new Set([yMin, 0, yMax])];
	const unit = comparison.metric === "damage" ? "damage" : "potency";

	const hover =
		hoverT === undefined
			? undefined
			: {
					t: hoverT,
					a: totalAt(comparison.a, hoverT),
					b: totalAt(comparison.b, hoverT),
				};

	return <div className="rl-chart">
		<svg
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={`Lead of ${nameA} over ${nameB} in ${unit} over time`}
			onMouseLeave={() => setHoverT(undefined)}
			onMouseMove={(e) => {
				const box = e.currentTarget.getBoundingClientRect();
				const px = ((e.clientX - box.left) / box.width) * W;
				const t = ((px - PAD.left) / (W - PAD.left - PAD.right)) * xMax;
				setHoverT(t >= 0 && t <= xMax ? t : undefined);
			}}
		>
			{comparison.windows.map((w, i) => <rect
				key={i}
				className="rl-chart-window"
				x={x(Math.max(0, w.start))}
				y={PAD.top}
				width={Math.max(0, x(Math.min(xMax, w.end)) - x(Math.max(0, w.start)))}
				height={H - PAD.top - PAD.bottom}
			/>)}
			{yTicks.map((d) => <g key={d}>
				<line
					className={d === 0 ? "rl-chart-zero" : "rl-chart-grid"}
					x1={PAD.left}
					x2={W - PAD.right}
					y1={y(d)}
					y2={y(d)}
				/>
				<text className="rl-chart-label" x={PAD.left - 6} y={y(d) + 4} textAnchor="end">
					{formatNumber(d)}
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
			{comparison.cutoffs.map(
				(c) =>
					c.time <= xMax && <line
						key={c.time}
						className="rl-chart-cutoff"
						x1={x(c.time)}
						x2={x(c.time)}
						y1={PAD.top}
						y2={H - PAD.bottom}
					/>,
			)}
			<text className="rl-chart-label" x={PAD.left + 6} y={PAD.top + 12}>
				▲ {nameA} ahead
			</text>
			<text className="rl-chart-label" x={PAD.left + 6} y={H - PAD.bottom - 6}>
				▼ {nameB} ahead
			</text>
			<path className="rl-chart-line" d={path} />
			<text className="rl-chart-value" x={W - PAD.right} y={y(last) - 6} textAnchor="end">
				{formatNumber(last)}
			</text>
			{hover && <line
				className="rl-chart-crosshair"
				x1={x(hover.t)}
				x2={x(hover.t)}
				y1={PAD.top}
				y2={H - PAD.bottom}
			/>}
		</svg>
		{hover && <div
			className="rl-chart-tooltip"
			style={{
				left: `${(x(hover.t) / W) * 100}%`,
				// Flip to the left of the crosshair near the right edge.
				transform: x(hover.t) / W > 0.7 ? "translateX(calc(-100% - 8px))" : undefined,
			}}
			role="status"
		>
			<div>
				<b>{formatNumber(hover.t, 2)} s</b>
			</div>
			<div>
				{nameA}: {formatNumber(hover.a)}
			</div>
			<div>
				{nameB}: {formatNumber(hover.b)}
			</div>
			<div>Lead: {formatNumber(hover.a - hover.b)}</div>
		</div>}
	</div>;
}

function simulate(
	cache: SimulationCache,
	rotation: RotationDocument,
	scenario: ScenarioDocument,
): RotationResult | string {
	try {
		return cache.get(rotation, scenario).result;
	} catch (e) {
		return (e as Error).message;
	}
}

export function ComparisonView(props: {
	rotations: RotationDocument[];
	scenario: ScenarioDocument;
	cache: SimulationCache;
	defaultA: string;
}) {
	const { rotations, scenario, cache } = props;
	const [idA, setIdA] = useState(props.defaultA);
	const [idB, setIdB] = useState(
		() => rotations.find((r) => r.id !== props.defaultA)?.id ?? props.defaultA,
	);
	const [extraCutoffs, setExtraCutoffs] = useState<number[]>([]);
	const [cutoffText, setCutoffText] = useState("");

	const rotationA = rotations.find((r) => r.id === idA) ?? rotations[0];
	const rotationB = rotations.find((r) => r.id === idB) ?? rotations[0];
	const resultA = useMemo(
		() => simulate(cache, rotationA, scenario),
		[cache, rotationA, scenario],
	);
	const resultB = useMemo(
		() => simulate(cache, rotationB, scenario),
		[cache, rotationB, scenario],
	);

	const ready = typeof resultA !== "string" && typeof resultB !== "string";
	const endTime = ready ? Math.max(resultA.endTime, resultB.endTime) : 0;
	const comparison = useMemo(() => {
		if (!ready) return undefined;
		const cutoffs = [...new Set([...extraCutoffs, endTime])].sort((p, q) => p - q);
		return compareRotations(resultA, resultB, cutoffs);
	}, [ready, resultA, resultB, extraCutoffs, endTime]);

	const nameA = `A: ${rotationA.name || "(unnamed)"}`;
	const nameB = `B: ${rotationB.name || "(unnamed)"}`;
	const unit = comparison?.metric === "potency" ? "Potency" : "Damage";

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
			<span className="rl-note">Both simulated under scenario “{scenario.name}”.</span>
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

		{comparison && <>
			<h2>
				Lead over time ({unit.toLowerCase()}
				{comparison.metric === "potency" && ", no damage model for this job or level"})
			</h2>
			<LeadChart comparison={comparison} nameA={nameA} nameB={nameB} endTime={endTime} />
			<p className="rl-note">
				Shaded: party buff windows. Dashed: cutoffs. Above the line A is ahead, below B.
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
						<th className="rl-num">{unit} A</th>
						<th className="rl-num">DPS A</th>
						<th className="rl-num">{unit} B</th>
						<th className="rl-num">DPS B</th>
						<th className="rl-num">A − B</th>
						<th aria-label="Remove" />
					</tr>
				</thead>
				<tbody>
					{comparison.cutoffs.map((c) => <tr key={c.time} data-testid="cutoff-row">
						<td className="rl-num">{formatNumber(c.time, 2)} s</td>
						<td className="rl-num">{formatNumber(c.a)}</td>
						<td className="rl-num">{formatNumber(c.dpsA, 1)}</td>
						<td className="rl-num">{formatNumber(c.b)}</td>
						<td className="rl-num">{formatNumber(c.dpsB, 1)}</td>
						<td className="rl-num">{formatNumber(c.a - c.b)}</td>
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
			{comparison.windows.length === 0 ? (
				<p className="rl-note">The scenario has no party buffs.</p>
			) : (
				<table className="rl-table rl-compare-table">
					<thead>
						<tr>
							<th className="rl-num">Window</th>
							<th className="rl-num">{unit} A</th>
							<th className="rl-num">{unit} B</th>
							<th className="rl-num">A − B</th>
						</tr>
					</thead>
					<tbody>
						{comparison.windows.map((w, i) => <tr key={i}>
							<td className="rl-num">
								{formatNumber(w.start, 2)}–{formatNumber(w.end, 2)} s
							</td>
							<td className="rl-num">{formatNumber(w.a)}</td>
							<td className="rl-num">{formatNumber(w.b)}</td>
							<td className="rl-num">{formatNumber(w.a - w.b)}</td>
						</tr>)}
					</tbody>
				</table>
			)}
		</>}
	</section>;
}
