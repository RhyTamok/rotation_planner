import React, { useState } from "react";

import { BaselineComparison } from "../../comparison/baseline";
import { gaugesAt, TIME_TOLERANCE } from "../../comparison/compare";
import {
	DEFAULT_CUTOFF_STEP,
	isListedCutoff,
	withCutoff,
	withoutCutoff,
} from "../../comparison/cutoffs";
import { GaugeValue } from "../../rules/resourceTracking";
import { formatDeltaPct, formatNumber, formatSigned } from "../format";
import { SimulatedEntry } from "./entries";

function Gauges(props: { gauges?: GaugeValue[] }) {
	if (!props.gauges) return null;
	return <>
		{props.gauges.map((g) => <div key={g.key} className="rl-note">
			{g.label} {g.amount}
			{g.max <= 5 && `/${g.max}`}
		</div>)}
	</>;
}

function CutoffTime(props: { time: number; endTime: number }) {
	const isEnd = Math.abs(props.time - props.endTime) <= TIME_TOLERANCE;
	return <>
		{formatNumber(props.time, 2)} s{isEnd && " (end)"}
	</>;
}

// The cutoff table (view B): DPS per configuration, and when there is a baseline to measure from,
// its difference and the rank. Below it, totals and leftover gauges at the same cutoffs.
export function CutoffTables(props: {
	entries: SimulatedEntry[];
	comparison: BaselineComparison;
	// Editable; the end of the fight is always reported in addition.
	listed: number[];
	// Whether the list is a stored one rather than the default grid.
	custom: boolean;
	endTime: number;
	perSecond: string;
	unit: string;
	// False with one simulated configuration, or when the baseline could not be simulated.
	showDeltas: boolean;
	showRank: boolean;
	// Who is within the threshold of the best at this instant: "All", or their letters.
	withinAt: (time: number) => string;
	onChange: (cutoffs: number[]) => void;
}) {
	const { entries, comparison, listed, endTime, perSecond, unit, showDeltas, showRank } = props;
	const [text, setText] = useState("");
	const span = 1 + (showDeltas ? 2 : 0) + (showRank ? 1 : 0);
	const cellsFor = (i: number, row: BaselineComparison["cutoffs"][number]) => {
		const cell = row.rows[i];
		return <React.Fragment key={cell.id}>
			<td className="rl-num">{formatNumber(cell.dps, 1)}</td>
			{showDeltas && <td className="rl-num">{formatSigned(cell.deltaDps, 1)}</td>}
			{showDeltas && <td className="rl-num">{formatDeltaPct(cell.deltaPct)}</td>}
			{showRank && <td className="rl-num">{cell.rank === 1 ? <b>1</b> : cell.rank}</td>}
		</React.Fragment>;
	};

	return <>
		<h2>At cutoffs</h2>
		<div className="rl-compare-controls">
			<input
				type="number"
				min={0}
				step={1}
				placeholder="Cutoff (s)"
				aria-label="Cutoff seconds"
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<button
				onClick={() => {
					const t = Number(text);
					if (text.trim() !== "" && Number.isFinite(t) && t > 0) {
						props.onChange(withCutoff(listed, t));
						setText("");
					}
				}}
			>
				Add cutoff
			</button>
			{props.custom ? (
				<button onClick={() => props.onChange([])}>
					Use every {DEFAULT_CUTOFF_STEP} s
				</button>
			) : (
				<span className="rl-note">
					Every {DEFAULT_CUTOFF_STEP} s and the end of the fight.
				</span>
			)}
		</div>
		<div className="rl-table-scroll">
			<table className="rl-table rl-compare-table rl-cutoff-table">
				<thead>
					<tr>
						<th rowSpan={2} className="rl-num">
							Cutoff
						</th>
						{entries.map((e) => <th key={e.id} colSpan={span}>
							{e.label}
							{showDeltas && e.id === comparison.baselineId && " (baseline)"}
						</th>)}
						{showRank && <th rowSpan={2}>Within ε</th>}
						<th rowSpan={2} aria-label="Remove" />
					</tr>
					<tr>
						{entries.map((e) => <React.Fragment key={e.id}>
							<th className="rl-num">{perSecond}</th>
							{showDeltas && <th className="rl-num">Δ{perSecond}</th>}
							{showDeltas && <th className="rl-num">Δ%</th>}
							{showRank && <th className="rl-num">Rank</th>}
						</React.Fragment>)}
					</tr>
				</thead>
				<tbody>
					{comparison.cutoffs.map((row) => <tr key={row.time} data-testid="cutoff-row">
						<td className="rl-num">
							<CutoffTime time={row.time} endTime={endTime} />
						</td>
						{entries.map((_, i) => cellsFor(i, row))}
						{showRank && <td
							title={
								props.withinAt(row.time) === "All"
									? "All configurations within the selected threshold."
									: undefined
							}
						>
							{props.withinAt(row.time)}
						</td>}
						<td>
							{isListedCutoff(listed, row.time) && <button
								className="rl-remove"
								aria-label="Remove cutoff"
								onClick={() => props.onChange(withoutCutoff(listed, row.time))}
							>
								×
							</button>}
						</td>
					</tr>)}
				</tbody>
			</table>
		</div>
		{showRank && <p className="rl-note">
			Bold rank 1: the exact leader. Within ε: close to the best at that cutoff, whichever it
			is, not to the baseline.
		</p>}

		<details className="rl-compare-details" open={entries.length === 1}>
			<summary>{unit} and gauges at cutoffs</summary>
			<div className="rl-table-scroll">
				<table className="rl-table rl-compare-table rl-cutoff-table">
					<thead>
						<tr>
							<th className="rl-num">Cutoff</th>
							{entries.map((e) => <th key={e.id}>{e.label}</th>)}
						</tr>
					</thead>
					<tbody>
						{comparison.cutoffs.map((row) => <tr
							key={row.time}
							data-testid="resource-row"
						>
							<td className="rl-num">
								<CutoffTime time={row.time} endTime={endTime} />
							</td>
							{entries.map((e, i) => <td key={e.id}>
								<div className="rl-num">{formatNumber(row.rows[i].total)}</div>
								<Gauges gauges={gaugesAt(e.result, row.time)} />
							</td>)}
						</tr>)}
					</tbody>
				</table>
			</div>
			<p className="rl-note">Gauges as left by the last action pressed before the cutoff.</p>
		</details>
	</>;
}
