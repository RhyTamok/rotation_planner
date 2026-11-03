import React, { useState } from "react";

import { RotationDocument } from "../models/Rotation";
import { targetRangeProblems } from "../rules/targets";
import { TargetRange } from "../simulation/types";
import { NumberInput } from "./ScenarioPanel";

// Times with more than one enemy, for the current rotation only (rules/targets.ts).
export function TargetsPanel(props: {
	rotation: RotationDocument;
	rotations: RotationDocument[];
	onRotationChange: (rotation: RotationDocument) => void;
}) {
	const { rotation, rotations, onRotationChange } = props;
	const others = rotations.filter((r) => r.id !== rotation.id);
	const [copyFrom, setCopyFrom] = useState<string>("");
	const source = others.find((r) => r.id === copyFrom) ?? others[0];

	const setTargets = (targets: TargetRange[]) =>
		onRotationChange({ ...rotation, targets, updatedAt: new Date().toISOString() });
	const updateRow = (i: number, patch: Partial<TargetRange>) =>
		setTargets(rotation.targets.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const problems = targetRangeProblems(rotation.targets);
	const lastEnd = rotation.targets.reduce((end, r) => Math.max(end, r.end), 0);

	return <>
		<h2>Targets (this rotation)</h2>
		<p className="rl-hint">
			Seconds from the pull; the start counts, the end does not. Enemies include the main
			target.
		</p>
		{rotation.targets.map((r, i) => <div key={i}>
			<div className="rl-window">
				<NumberInput
					label="Targets start"
					step={0.1}
					value={r.start}
					onChange={(v) => updateRow(i, { start: v ?? 0 })}
				/>
				to
				<NumberInput
					label="Targets end"
					step={0.1}
					value={r.end}
					onChange={(v) => updateRow(i, { end: v ?? 0 })}
				/>
				<NumberInput
					label="Enemies"
					value={r.enemies}
					onChange={(v) => updateRow(i, { enemies: v ?? 2 })}
				/>
				<button
					aria-label="Remove targets"
					onClick={() => setTargets(rotation.targets.filter((_, j) => j !== i))}
				>
					×
				</button>
			</div>
			{problems[i] && <div className="rl-banner" role="alert">
				Row {i + 1}: {problems[i]}
			</div>}
		</div>)}
		<button
			onClick={() =>
				setTargets([...rotation.targets, { start: lastEnd, end: lastEnd + 10, enemies: 3 }])
			}
		>
			Add targets
		</button>
		{others.length > 0 && <div className="rl-field">
			<select
				aria-label="Copy targets from"
				value={source?.id}
				onChange={(e) => setCopyFrom(e.target.value)}
			>
				{others.map((r) => <option key={r.id} value={r.id}>
					{r.name || "(unnamed)"}
				</option>)}
			</select>
			<button
				disabled={source === undefined}
				onClick={() => source && setTargets(source.targets.map((r) => ({ ...r })))}
			>
				Copy targets
			</button>
		</div>}
	</>;
}
