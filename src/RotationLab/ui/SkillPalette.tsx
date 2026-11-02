import React, { useMemo } from "react";

import { LevelSync } from "../../Game/Common";
import { ACTIONS, ActionKey } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { getAllAssignableSkillNames, getSkillAssetPath } from "../../Game/Skills";
import { RotationSimulator } from "../simulation/RotationSimulator";
import { RotationStep } from "../simulation/types";

export function skillIconUrl(job: ShellJob, action: ActionKey): string {
	return `/assets/Skills/${getSkillAssetPath(job, action)}`;
}

export function actionName(action: ActionKey): string {
	return ACTIONS[action]?.name ?? action;
}

// The job's default hotbar buttons at this level. Combo and follow-up actions are reached by
// pressing their base button again, exactly as in game; the table shows what actually executed.
function paletteActions(job: ShellJob, level: LevelSync): ActionKey[] {
	return getAllAssignableSkillNames(new RotationSimulator(job, { config: { level } }).game);
}

export function SkillPalette(props: {
	job: ShellJob;
	level: LevelSync;
	onInsert: (step: RotationStep) => void;
}) {
	const { job, level, onInsert } = props;
	const actions = useMemo(() => paletteActions(job, level), [job, level]);
	return <aside className="rl-palette" aria-label="Skill palette">
		<h2>Insert</h2>
		<div className="rl-palette-grid">
			{actions.map((action) => <button
				key={action}
				onClick={() => onInsert({ type: "skill", action })}
				title={`Insert ${actionName(action)} after the selected row`}
			>
				<img className="rl-icon" src={skillIconUrl(job, action)} alt="" />
				{actionName(action)}
			</button>)}
		</div>
		<h2>Timing</h2>
		<div className="rl-palette-grid">
			<button onClick={() => onInsert({ type: "wait", seconds: 1 })}>Wait 1s</button>
			<button onClick={() => onInsert({ type: "jumpTo", displayTime: 0 })}>
				Jump to time
			</button>
		</div>
	</aside>;
}
