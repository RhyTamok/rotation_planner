import React, { useMemo } from "react";

import { LevelSync } from "../../Game/Common";
import { ACTIONS, ActionKey } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { getAllAssignableSkillNames, getSkillAssetPath } from "../../Game/Skills";
import { hotbarStateAfter } from "../editor/paletteState";
import { RotationSimulator } from "../simulation/RotationSimulator";
import { RotationStep, SimulationOptions } from "../simulation/types";
import { formatNumber } from "./format";

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
	// The rotation up to the insertion point; buttons show the hotbar as it would look there.
	prefix: RotationStep[];
	options: SimulationOptions;
	countdownExtension?: number;
	onInsert: (step: RotationStep) => void;
}) {
	const { job, level, prefix, options, countdownExtension, onInsert } = props;
	const actions = useMemo(() => paletteActions(job, level), [job, level]);
	const hotbar = useMemo(() => {
		try {
			return hotbarStateAfter(job, prefix, actions, options, countdownExtension);
		} catch {
			// The scenario is invalid mid-edit (the summary reports why); show the plain hotbar.
			return hotbarStateAfter(job, [], actions, { config: { level } });
		}
	}, [job, level, prefix, actions, options, countdownExtension]);
	return <aside className="rl-palette" aria-label="Skill palette">
		<h2>Insert at {formatNumber(hotbar.time, 2)} s</h2>
		<div className="rl-palette-grid">
			{actions.map((action) => {
				const button = hotbar.buttons.get(action)!;
				const replaced = button.shows !== action;
				const classes = [
					button.usable ? "" : "rl-unusable",
					button.highlight ? "rl-highlight" : "",
				].join(" ");
				return <button
					key={action}
					className={classes}
					onClick={() => onInsert({ type: "skill", action })}
					title={
						replaced
							? `Insert ${actionName(action)} (executes ${actionName(button.shows)}) after the selected row`
							: `Insert ${actionName(action)} after the selected row`
					}
				>
					<span className="rl-button-icon">
						<img className="rl-icon" src={skillIconUrl(job, button.shows)} alt="" />
						{button.cooldown !== undefined && <span className="rl-cooldown">
							{formatNumber(button.cooldown, 1)}
						</span>}
						{button.charges && <span className="rl-charges">
							{button.charges.available}
						</span>}
					</span>
					{actionName(button.shows)}
				</button>;
			})}
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
