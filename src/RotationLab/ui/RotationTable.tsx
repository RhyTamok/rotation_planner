import React, { useEffect, useRef } from "react";

import { ShellJob } from "../../Game/Data/Jobs";
import { EditorRow } from "../editor/rotationEdits";
import { GaugeValue, trackedGauges } from "../rules/resourceTracking";
import { RotationStep } from "../simulation/types";
import { actionName, skillIconUrl } from "./SkillPalette";

export function formatNumber(x: number | undefined, digits = 0): string {
	return x === undefined
		? ""
		: x.toLocaleString(undefined, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
			});
}

function parseNumber(text: string): number | undefined {
	const x = Number(text);
	return text.trim() === "" || !Number.isFinite(x) ? undefined : x;
}

function StepCell(props: {
	job: ShellJob;
	row: EditorRow;
	onUpdate: (step: RotationStep) => void;
}) {
	const { job, row, onUpdate } = props;
	const step = row.entry.step;
	if (step.type === "wait") {
		return <>
			Wait{" "}
			<input
				type="number"
				min={0}
				step={0.1}
				value={step.seconds}
				aria-label="Wait seconds"
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => {
					const seconds = parseNumber(e.target.value);
					if (seconds !== undefined && seconds >= 0) onUpdate({ type: "wait", seconds });
				}}
				style={{ width: 64 }}
			/>{" "}
			s
		</>;
	}
	if (step.type === "jumpTo") {
		return <>
			Jump to{" "}
			<input
				type="number"
				step={0.1}
				value={step.displayTime}
				aria-label="Jump to time"
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => {
					const displayTime = parseNumber(e.target.value);
					if (displayTime !== undefined) onUpdate({ type: "jumpTo", displayTime });
				}}
				style={{ width: 72 }}
			/>{" "}
			s
		</>;
	}
	const executed = row.action?.executedAction ?? step.action;
	return <>
		<img className="rl-icon" src={skillIconUrl(job, executed)} alt="" /> {actionName(executed)}
		{executed !== step.action && <span className="rl-note">
			{" "}
			(pressed {actionName(step.action)})
		</span>}
		<label className="rl-delay" title="Extra delay after the action becomes usable">
			+
			<input
				type="number"
				min={0}
				step={0.1}
				value={step.delay ?? 0}
				aria-label="Delay seconds"
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => {
					const delay = parseNumber(e.target.value);
					if (delay === undefined || delay < 0) return;
					const rest = { ...step };
					delete rest.delay;
					onUpdate(delay > 0 ? { ...rest, delay } : rest);
				}}
			/>
			s
		</label>
	</>;
}

function GaugeCell(props: { gauge?: GaugeValue }) {
	const { gauge } = props;
	if (!gauge) return null;
	if (gauge.max > 5) return <>{gauge.amount}</>;
	return <span className="rl-pips" aria-label={`${gauge.amount} of ${gauge.max}`}>
		{Array.from({ length: gauge.max }, (_, i) => <span
			key={i}
			className={i < gauge.amount ? "rl-pip rl-pip-on" : "rl-pip"}
		/>)}
	</span>;
}

function rowNotes(row: EditorRow): { text: string; kind: "error" | "warning" | "" }[] {
	const { action, error } = row;
	if (error) return [{ text: error.message, kind: "error" }];
	if (!action) return [];
	const notes: { text: string; kind: "error" | "warning" | "" }[] = [];
	if (!action.valid) notes.push({ text: action.invalidReasons.join("; "), kind: "error" });
	if (action.pullHold !== undefined) {
		notes.push({ text: `held ${formatNumber(action.pullHold, 2)} s to land at 0 s`, kind: "" });
	}
	if (action.gcdDelay !== undefined) {
		notes.push(
			action.clipped
				? { text: `clipped GCD by ${formatNumber(action.gcdDelay, 2)} s`, kind: "warning" }
				: { text: `GCD delayed ${formatNumber(action.gcdDelay, 2)} s`, kind: "" },
		);
	}
	if ((action.pendingDamage ?? 0) > 0) notes.push({ text: "lands after cutoff", kind: "" });
	return notes;
}

// Active timers at the selected row, or at the last action before it (e.g. for a wait row).
function TimerPanel(props: { rows: EditorRow[]; selectedId?: string }) {
	const { rows, selectedId } = props;
	const end = selectedId ? rows.findIndex((r) => r.entry.id === selectedId) : rows.length - 1;
	const row = rows
		.slice(0, end + 1)
		.reverse()
		.find((r) => r.action);
	const timers = row?.action?.resources.timers ?? [];
	return <div className="rl-timers" aria-label="Timers">
		<span className="rl-timers-title">{row ? `After #${row.index + 1}` : "Timers"}</span>
		{timers.length === 0 ? (
			<span className="rl-note">no active timers</span>
		) : (
			timers.map((t) => <span className="rl-timer" key={t.label}>
				{t.label}
				{t.stacks > 1 && ` ×${t.stacks}`}
				{t.remaining !== undefined && <b> {formatNumber(t.remaining, 1)}</b>}
			</span>)
		)}
	</div>;
}

export function RotationTable(props: {
	job: ShellJob;
	rows: EditorRow[];
	selectedId?: string;
	onSelect: (id: string) => void;
	onUpdateStep: (id: string, step: RotationStep) => void;
	onKeyDown: (e: React.KeyboardEvent) => void;
}) {
	const { job, rows, selectedId, onSelect, onUpdateStep, onKeyDown } = props;
	const selectedRef = useRef<HTMLTableRowElement>(null);
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	const gauges = trackedGauges(job);

	return <div className="rl-table-wrap" tabIndex={0} onKeyDown={onKeyDown} aria-label="Rotation">
		{rows.length > 0 && <TimerPanel rows={rows} selectedId={selectedId} />}
		{rows.length === 0 ? (
			<div className="rl-empty">Click a skill in the palette to start the rotation.</div>
		) : (
			<table className="rl-table">
				<thead>
					<tr>
						<th className="rl-num">#</th>
						<th className="rl-num">Time</th>
						<th>Action</th>
						<th className="rl-num">Potency</th>
						<th className="rl-num">Damage</th>
						{gauges.map((g) => <th className="rl-gauge" key={g.key}>
							{g.label}
						</th>)}
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const { entry, action, error } = row;
						const invalid = (action && !action.valid) || error !== undefined;
						const classes = [
							entry.id === selectedId ? "rl-selected" : "",
							action && !action.isGCD ? "rl-ogcd" : "",
							invalid ? "rl-invalid" : "",
						].join(" ");
						return <tr
							key={entry.id}
							className={classes}
							ref={entry.id === selectedId ? selectedRef : undefined}
							onClick={() => onSelect(entry.id)}
							data-testid="rotation-row"
						>
							<td className="rl-num">{row.index + 1}</td>
							<td className="rl-num">{formatNumber(action?.startTime, 2)}</td>
							<td className="rl-action">
								<StepCell
									job={job}
									row={row}
									onUpdate={(step) => onUpdateStep(entry.id, step)}
								/>
							</td>
							<td className="rl-num">
								{action &&
									formatNumber(action.appliedPotency + action.pendingPotency)}
							</td>
							<td className="rl-num">
								{action &&
									formatNumber(
										(action.expectedDamage ?? 0) + (action.pendingDamage ?? 0),
									)}
							</td>
							{gauges.map((g) => <td className="rl-gauge" key={g.key}>
								<GaugeCell
									gauge={action?.resources.gauges.find((x) => x.key === g.key)}
								/>
							</td>)}
							<td className="rl-note">
								{rowNotes(row).map((n, i) => <span
									key={i}
									className={n.kind ? `rl-${n.kind}` : undefined}
								>
									{i > 0 && " · "}
									{n.text}
								</span>)}
							</td>
						</tr>;
					})}
				</tbody>
			</table>
		)}
	</div>;
}
