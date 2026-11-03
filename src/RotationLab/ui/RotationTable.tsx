import React, { useEffect, useMemo, useRef, useState } from "react";

import { ShellJob } from "../../Game/Data/Jobs";
import { EditorRow } from "../editor/rotationEdits";
import { buffLanes, laneCoverage } from "../editor/buffLanes";
import { GaugeValue, trackedGauges } from "../rules/resourceTracking";
import { PartyBuffWindow, RotationStep } from "../simulation/types";
import { formatNumber } from "./format";
import { actionName, skillIconUrl } from "./SkillPalette";

export { formatNumber };

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
	if (action.ghostedBy !== undefined) {
		notes.push({
			text: `ghosted by ${formatNumber(action.ghostedBy, 2)} s (landed in downtime, effects only)`,
			kind: "",
		});
	}
	for (const combo of action.comboBreaks ?? []) {
		notes.push({ text: `breaks the ${combo}`, kind: "warning" });
	}
	if ((action.pendingDamage ?? 0) > 0) notes.push({ text: "lands after cutoff", kind: "" });
	return notes;
}

// Debug columns: seconds since the previous GCD (GCD rows only) and since the previous action,
// both measured between start times.
function timingDeltas(rows: EditorRow[]): Map<string, { sinceGcd?: number; sinceAction?: number }> {
	const deltas = new Map<string, { sinceGcd?: number; sinceAction?: number }>();
	let lastStart: number | undefined;
	let lastGcdStart: number | undefined;
	for (const { entry, action } of rows) {
		if (!action) continue;
		deltas.set(entry.id, {
			sinceAction: lastStart === undefined ? undefined : action.startTime - lastStart,
			sinceGcd:
				action.isGCD && lastGcdStart !== undefined
					? action.startTime - lastGcdStart
					: undefined,
		});
		lastStart = action.startTime;
		if (action.isGCD) lastGcdStart = action.startTime;
	}
	return deltas;
}

const DEBUG_KEY = "rotationLab.debugColumns";

function loadDebug(): boolean {
	try {
		return localStorage.getItem(DEBUG_KEY) === "1";
	} catch {
		return false;
	}
}

function saveDebug(on: boolean) {
	try {
		localStorage.setItem(DEBUG_KEY, on ? "1" : "0");
	} catch {
		// Storage may be unavailable (private mode); the toggle still works for this session.
	}
}

// Active timers at the selected row, or at the last action before it (e.g. for a wait row).
function TimerPanel(props: {
	rows: EditorRow[];
	selectedId?: string;
	debug: boolean;
	onDebugChange: (on: boolean) => void;
}) {
	const { rows, selectedId, debug, onDebugChange } = props;
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
			timers.map((t) => <span
				className="rl-timer"
				key={t.label}
				title={t.label}
				data-testid="timer"
			>
				<img className="rl-timer-icon" src={`/assets/${t.icon}`} alt={t.label} />
				{t.stacks > 1 && <span className="rl-timer-stacks">{t.stacks}</span>}
				<span className="rl-timer-time">
					{t.remaining === undefined ? "∞" : formatNumber(t.remaining, 1)}
				</span>
			</span>)
		)}
		<label className="rl-debug-toggle">
			<input
				type="checkbox"
				checked={debug}
				onChange={(e) => onDebugChange(e.target.checked)}
			/>{" "}
			Debug
		</label>
	</div>;
}

export function RotationTable(props: {
	job: ShellJob;
	rows: EditorRow[];
	selectedId?: string;
	// `extend`: Shift held, grow the selection to this row.
	onSelect: (id: string, extend?: boolean) => void;
	onUpdateStep: (id: string, step: RotationStep) => void;
	onRemove: (id: string) => void;
	// Moves the entry so that it ends up before the row currently at `beforeIndex`
	// (rows.length = to the end).
	onMove: (id: string, beforeIndex: number) => void;
	onKeyDown: (e: React.KeyboardEvent) => void;
	partyBuffs: Required<PartyBuffWindow>[];
	// Ids of every selected row (a range); `selectedId` is the one the arrow keys move.
	selection?: string[];
	onCopy?: (e: React.ClipboardEvent) => void;
	onCut?: (e: React.ClipboardEvent) => void;
	onPaste?: (e: React.ClipboardEvent) => void;
}) {
	const { job, rows, selectedId, onSelect, onUpdateStep, onRemove, onMove, onKeyDown } = props;
	const selected = useMemo(
		() => new Set(props.selection ?? (selectedId ? [selectedId] : [])),
		[props.selection, selectedId],
	);
	const lanes = useMemo(() => buffLanes(job, props.partyBuffs), [job, props.partyBuffs]);
	const coverage = useMemo(() => {
		const times = rows.map((r) => r.action?.startTime ?? NaN);
		return lanes.map((lane) => laneCoverage(lane, times));
	}, [lanes, rows]);
	const selectedRef = useRef<HTMLTableRowElement>(null);
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	const gauges = trackedGauges(job);
	const [dragId, setDragId] = useState<string>();
	const [dropIndex, setDropIndex] = useState<number>();
	const endDrag = () => {
		setDragId(undefined);
		setDropIndex(undefined);
	};
	const [debug, setDebug] = useState(loadDebug);
	const deltas = debug ? timingDeltas(rows) : undefined;

	return <div
		className="rl-table-wrap"
		tabIndex={0}
		onKeyDown={onKeyDown}
		onCopy={props.onCopy}
		onCut={props.onCut}
		onPaste={props.onPaste}
		aria-label="Rotation"
	>
		{rows.length > 0 && <TimerPanel
			rows={rows}
			selectedId={selectedId}
			debug={debug}
			onDebugChange={(on) => {
				setDebug(on);
				saveDebug(on);
			}}
		/>}
		{rows.length === 0 ? (
			<div className="rl-empty">Click a skill in the palette to start the rotation.</div>
		) : (
			<table className="rl-table">
				<thead>
					<tr>
						<th className="rl-num">#</th>
						<th className="rl-num">Time</th>
						{deltas && <>
							<th className="rl-num" title="Time since the previous GCD">
								Δ GCD
							</th>
							<th className="rl-num" title="Time since the previous action">
								Δ action
							</th>
						</>}
						{lanes.length > 0 && <th className="rl-buffs" aria-label="Party buffs">
							{lanes.map((lane) => <span className="rl-buff-lane" key={lane.buff}>
								<img
									className="rl-buff-icon"
									src={`/assets/${lane.icon}`}
									alt={lane.buff}
									title={lane.buff}
								/>
							</span>)}
						</th>}
						<th>Action</th>
						<th className="rl-num">Potency</th>
						<th className="rl-num">Damage</th>
						{gauges.map((g) => <th className="rl-gauge" key={g.key}>
							{g.label}
						</th>)}
						<th>Notes</th>
						<th aria-label="Remove" />
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const { entry, action, error } = row;
						const invalid = (action && !action.valid) || error !== undefined;
						const classes = [
							selected.has(entry.id) ? "rl-selected" : "",
							action && !action.isGCD ? "rl-ogcd" : "",
							invalid ? "rl-invalid" : "",
							entry.id === dragId ? "rl-dragging" : "",
							dragId && dropIndex === row.index ? "rl-drop-before" : "",
							dragId && dropIndex === rows.length && row.index === rows.length - 1
								? "rl-drop-after"
								: "",
						].join(" ");
						return <tr
							key={entry.id}
							className={classes}
							ref={entry.id === selectedId ? selectedRef : undefined}
							onClick={(e) => onSelect(entry.id, e.shiftKey)}
							aria-selected={selected.has(entry.id)}
							onDragOver={(e) => {
								if (!dragId) return;
								e.preventDefault();
								const box = e.currentTarget.getBoundingClientRect();
								const after = e.clientY > box.top + box.height / 2;
								setDropIndex(row.index + (after ? 1 : 0));
							}}
							onDrop={(e) => {
								e.preventDefault();
								if (dragId && dropIndex !== undefined) onMove(dragId, dropIndex);
								endDrag();
							}}
							data-testid="rotation-row"
						>
							<td className="rl-num">
								<span
									className="rl-drag"
									draggable
									title="Drag to move"
									aria-label="Drag to move"
									onDragStart={(e) => {
										e.dataTransfer.setData("text/plain", entry.id);
										e.dataTransfer.effectAllowed = "move";
										const tr = e.currentTarget.closest("tr");
										if (tr) e.dataTransfer.setDragImage(tr, 0, 0);
										setDragId(entry.id);
									}}
									onDragEnd={endDrag}
								>
									⠿
								</span>
								{row.index + 1}
							</td>
							<td className="rl-num">{formatNumber(action?.startTime, 2)}</td>
							{deltas && <>
								<td className="rl-num" data-testid="delta-gcd">
									{formatNumber(deltas.get(entry.id)?.sinceGcd, 3)}
								</td>
								<td className="rl-num" data-testid="delta-action">
									{formatNumber(deltas.get(entry.id)?.sinceAction, 3)}
								</td>
							</>}
							{lanes.length > 0 && <td className="rl-buffs">
								{lanes.map((lane, l) => {
									const c = coverage[l][row.index];
									return <span
										className="rl-buff-lane"
										key={lane.buff}
										data-testid={c ? "buff-active" : undefined}
										title={
											c &&
											`${lane.buff}: ${formatNumber(c.window.time, 2)}–${formatNumber(c.window.time + c.window.duration, 2)} s, ${formatNumber(c.remaining, 1)} s left`
										}
									>
										{c &&
											(c.first ? (
												<img
													className="rl-buff-icon"
													src={`/assets/${lane.icon}`}
													alt={lane.buff}
												/>
											) : (
												<span
													className="rl-buff-bar"
													style={{ background: lane.color }}
												/>
											))}
									</span>;
								})}
							</td>}
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
							<td>
								<button
									className="rl-remove"
									title="Remove"
									aria-label="Remove step"
									onClick={(e) => {
										e.stopPropagation();
										onRemove(entry.id);
									}}
								>
									×
								</button>
							</td>
						</tr>;
					})}
				</tbody>
			</table>
		)}
	</div>;
}
