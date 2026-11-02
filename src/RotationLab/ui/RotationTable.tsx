import React, { useEffect, useRef } from "react";

import { ShellJob } from "../../Game/Data/Jobs";
import { EditorRow } from "../editor/rotationEdits";
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
	</>;
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

	return <div className="rl-table-wrap" tabIndex={0} onKeyDown={onKeyDown} aria-label="Rotation">
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
						const pending = (action?.pendingDamage ?? 0) > 0;
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
							<td className={`rl-note ${invalid ? "rl-error" : ""}`}>
								{error?.message ??
									(action && !action.valid
										? action.invalidReasons.join("; ")
										: pending
											? "lands after cutoff"
											: "")}
							</td>
						</tr>;
					})}
				</tbody>
			</table>
		)}
	</div>;
}
