import React from "react";

import { IntervalAnalysis, leaderChanges } from "../../comparison/competitive";
import { EffectiveInterval } from "../../comparison/sensitivity";
import { formatInterval, formatNumber, formatPercent } from "../format";
import { SimulatedEntry } from "./entries";
import { NumberField } from "./NumberField";

function CoverageBar(props: { entry: SimulatedEntry; leader: number; extra: number }) {
	const color = `var(--rl-series-${props.entry.letter.toLowerCase()})`;
	return <div
		className="rl-coverage"
		role="img"
		aria-label={`${props.entry.label}: exact leader ${formatPercent(props.leader, 1)}, also within the threshold ${formatPercent(props.extra, 1)}`}
	>
		<div
			className="rl-coverage-leader"
			style={{ width: `${props.leader * 100}%`, background: color }}
		/>
		<div
			className="rl-coverage-extra"
			style={{ width: `${props.extra * 100}%`, background: color }}
		/>
	</div>;
}

// Competitiveness and regret over an interval (design spec 4.4). It reports; it never names a winner.
export function CompetitivenessSection(props: {
	entries: SimulatedEntry[];
	// Undefined when the chosen interval leaves no time to evaluate.
	analysis?: IntervalAnalysis;
	interval?: EffectiveInterval;
	// What the fields show: the stored or default bounds, before clamping.
	start: number;
	end: number;
	custom: boolean;
	epsilonPct: number;
	perSecond: string;
	onInterval: (patch: { intervalStart?: number; intervalEnd?: number }) => void;
}) {
	const { entries, analysis, interval, perSecond } = props;
	const letter = (id: string) => entries.find((e) => e.id === id)?.letter ?? id;
	const positive = (v: number) => v > 0;
	// Every piece, including the zero-length one at the end, so that a last hit landing exactly there
	// counts here as it does in the cutoff table.
	const allWithin = analysis?.pieces.every((p) => p.competitive.length === entries.length);
	const changes = analysis ? leaderChanges(analysis.pieces) : [];

	return <>
		<h2>Competitiveness and regret</h2>
		<div className="rl-compare-controls rl-window-row">
			<span>
				Evaluate from{" "}
				<NumberField
					label="Evaluate from seconds"
					value={props.start}
					valid={positive}
					onCommit={(intervalStart) => props.onInterval({ intervalStart })}
				/>{" "}
				to{" "}
				<NumberField
					label="Evaluate to seconds"
					value={props.end}
					valid={positive}
					onCommit={(intervalEnd) => props.onInterval({ intervalEnd })}
				/>{" "}
				s
			</span>
			{props.custom && <button
				onClick={() =>
					props.onInterval({ intervalStart: undefined, intervalEnd: undefined })
				}
			>
				Use the chart's range
			</button>}
			{interval && <span className="rl-note" data-testid="competitive-interval">
				Evaluated {formatInterval(interval.start, interval.end)}
				{(interval.clampedStart || interval.clampedEnd) && " (limited to the fight)"} · ε{" "}
				{formatNumber(props.epsilonPct, 2)}%
			</span>}
		</div>
		{!analysis ? (
			<p className="rl-note">
				This interval has no time left to evaluate. Its end must be after its start, within
				the fight.
			</p>
		) : (
			<>
				<div className="rl-table-scroll">
					<table className="rl-table rl-compare-table rl-cutoff-table">
						<thead>
							<tr>
								<th>Configuration</th>
								<th>Coverage</th>
								<th className="rl-num">Leader</th>
								<th className="rl-num">Within ε</th>
								<th className="rl-num">Max regret ({perSecond})</th>
								<th className="rl-num">At</th>
								<th className="rl-num">Mean regret ({perSecond})</th>
								<th className="rl-num">Max regret (%)</th>
							</tr>
						</thead>
						<tbody>
							{analysis.entries.map((row, i) => <tr
								key={row.id}
								data-testid="competitive-row"
							>
								<td>{entries[i].label}</td>
								<td>
									<CoverageBar
										entry={entries[i]}
										leader={row.leaderCoverage}
										extra={row.competitiveNotLeaderCoverage}
									/>
								</td>
								<td className="rl-num">{formatPercent(row.leaderCoverage, 1)}</td>
								<td className="rl-num">
									{formatPercent(row.competitiveCoverage, 1)}
								</td>
								<td className="rl-num">{formatNumber(row.maxRegretDps, 1)}</td>
								<td className="rl-num">{formatNumber(row.maxRegretDpsAt, 2)} s</td>
								<td className="rl-num">{formatNumber(row.meanRegretDps, 1)}</td>
								<td className="rl-num">{formatPercent(row.maxRegretFraction)}</td>
							</tr>)}
						</tbody>
					</table>
				</div>
				{allWithin && <p data-testid="all-within">
					All configurations within the selected threshold.
				</p>}
				<p className="rl-note">
					Bars: exact leader (solid), then within ε of the best but not leading (light).
					Coverage is a share of this interval's time, not the chance of a kill time, and
					entries overlap, so it need not add up to 100%. ε is a decision threshold, not
					statistical significance.
				</p>
				<details className="rl-compare-details">
					<summary>
						{analysis.transitions.length} changes within ε, {changes.length} exact
						leader changes
					</summary>
					<ul className="rl-change-list">
						{analysis.transitions.map((t, i) => <li
							key={`t${i}`}
							data-testid="transition"
						>
							{formatNumber(t.time, 2)} s: {letter(t.id)}{" "}
							{t.kind === "enter" ? "comes within ε" : "falls outside ε"}
							{t.landings.length > 0 &&
								` (hit: ${t.landings
									.map((l) => `${letter(l.id)} ${formatNumber(l.amount)}`)
									.join(", ")})`}
						</li>)}
					</ul>
					<ul className="rl-change-list">
						{changes.map((c) => <li key={c.time} data-testid="leader-change">
							{formatNumber(c.time, 2)} s: exact leader{" "}
							{c.leaders.map(letter).join(", ")}
						</li>)}
					</ul>
				</details>
			</>
		)}
	</>;
}
