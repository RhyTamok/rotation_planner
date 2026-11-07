import React from "react";

import { LocalSensitivity } from "../../comparison/sensitivity";
import { formatInterval, formatNumber, formatPercent, formatSigned } from "../format";
import { SimulatedEntry } from "./entries";
import { NumberField } from "./NumberField";

// Local cutoff sensitivity (design spec 4.5): what changes if the kill comes a little earlier or later.
export function SensitivitySection(props: {
	entries: SimulatedEntry[];
	// Undefined when T ± δ lies outside the simulated fight.
	sensitivity?: LocalSensitivity;
	time: number;
	delta: number;
	endTime: number;
	perSecond: string;
	// False when the baseline could not be simulated.
	showDeltas: boolean;
	onChange: (patch: { sensitivityTime?: number; sensitivityDelta?: number }) => void;
}) {
	const { entries, sensitivity, perSecond, showDeltas } = props;
	const positive = (v: number) => v > 0;
	return <>
		<h2>Local cutoff sensitivity</h2>
		<div className="rl-compare-controls rl-window-row">
			<span>
				Kill at{" "}
				<NumberField
					label="Sensitivity cutoff seconds"
					value={props.time}
					valid={positive}
					onCommit={(sensitivityTime) => props.onChange({ sensitivityTime })}
				/>{" "}
				s ±{" "}
				<NumberField
					label="Sensitivity seconds either side"
					value={props.delta}
					valid={positive}
					onCommit={(sensitivityDelta) => props.onChange({ sensitivityDelta })}
				/>{" "}
				s
			</span>
			{sensitivity && <span className="rl-note" data-testid="sensitivity-interval">
				Evaluated {formatInterval(sensitivity.interval.start, sensitivity.interval.end)}
				{(sensitivity.interval.clampedStart || sensitivity.interval.clampedEnd) &&
					` (limited to the fight; asked for ${formatInterval(props.time - props.delta, props.time + props.delta)})`}
			</span>}
		</div>
		{!sensitivity ? (
			<p className="rl-note">
				That is outside the simulated fight, which ends at {formatNumber(props.endTime, 2)}{" "}
				s. Nothing is extrapolated: extend the rotations to evaluate it.
			</p>
		) : (
			<>
				<div className="rl-table-scroll">
					<table className="rl-table rl-compare-table rl-cutoff-table">
						<thead>
							<tr>
								<th>Configuration</th>
								<th>Stays within ε</th>
								{showDeltas && <th className="rl-num">Lowest Δ{perSecond}</th>}
								{showDeltas && <th className="rl-num">Highest Δ{perSecond}</th>}
								<th className="rl-num">Max regret ({perSecond})</th>
								<th className="rl-num">Max regret (%)</th>
							</tr>
						</thead>
						<tbody>
							{sensitivity.entries.map((row, i) => <tr
								key={row.id}
								data-testid="sensitivity-row"
							>
								<td>{entries[i].label}</td>
								<td>{row.alwaysCompetitive ? "Yes" : "No"}</td>
								{showDeltas && <td className="rl-num">
									{formatSigned(row.lowestDeltaDps, 1)}
								</td>}
								{showDeltas && <td className="rl-num">
									{formatSigned(row.highestDeltaDps, 1)}
								</td>}
								<td className="rl-num">{formatNumber(row.maxRegretDps, 1)}</td>
								<td className="rl-num">{formatPercent(row.maxRegretFraction)}</td>
							</tr>)}
						</tbody>
					</table>
				</div>
				<p className="rl-note">
					Varies the kill time only: downtime and the rotations stay as they are. Regret
					is against the best at each instant{showDeltas && "; Δ against the baseline"}.
					The region is outlined on the difference chart.
				</p>
			</>
		)}
	</>;
}
