import React from "react";

import { BaselineComparison } from "../../comparison/baseline";
import { burstTable } from "../../comparison/burst";
import { TimeWindow } from "../../comparison/compare";
import { BurstWindow, ScenarioDocument } from "../../models/Scenario";
import { formatNumber, formatSigned } from "../format";
import { SimulatedEntry } from "./entries";
import { NumberField } from "./NumberField";

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

// Damage per burst window (view C). The windows still live on the scenario until roadmap M5.
export function BurstSection(props: {
	scenario: ScenarioDocument;
	derived: TimeWindow[];
	windows: TimeWindow[];
	entries: SimulatedEntry[];
	comparison: BaselineComparison;
	unit: string;
	showDeltas: boolean;
	onWindowsChange: (windows: BurstWindow[] | undefined) => void;
}) {
	const { windows, entries, comparison, unit, showDeltas } = props;
	const rows = burstTable(comparison, windows);
	return <>
		<h2>Burst windows</h2>
		<BurstWindowEditor
			scenario={props.scenario}
			derived={props.derived}
			onChange={props.onWindowsChange}
		/>
		{rows.length > 0 && <div className="rl-table-scroll">
			<table className="rl-table rl-compare-table rl-cutoff-table">
				<thead>
					<tr>
						<th>Window</th>
						{entries.map((e) => <React.Fragment key={e.id}>
							<th className="rl-num">
								{unit} {e.letter}
							</th>
							{showDeltas && e.id !== comparison.baselineId && <th className="rl-num">
								Δ {e.letter}
							</th>}
						</React.Fragment>)}
					</tr>
				</thead>
				<tbody>
					{rows.map((w, i) => <tr key={i} data-testid="window-row">
						<td>
							{w.label ? `${w.label}: ` : ""}
							{formatNumber(w.start, 2)}–{formatNumber(w.end, 2)} s
						</td>
						{w.rows.map((cell) => <React.Fragment key={cell.id}>
							<td className="rl-num">{formatNumber(cell.total)}</td>
							{showDeltas &&
								cell.id !== comparison.baselineId && <td className="rl-num">
									{formatSigned(cell.deltaTotal, 0)}
								</td>}
						</React.Fragment>)}
					</tr>)}
				</tbody>
			</table>
		</div>}
	</>;
}
