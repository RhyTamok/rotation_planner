import React, { useMemo } from "react";

import { getBuffColor } from "../../Game/Buffs";
import { BuffType } from "../../Game/Common";
import { ShellJob } from "../../Game/Data/Jobs";
import { makeDefaultConfig } from "../../Game/GameConfig";
import {
	SCENARIO_STAT_DEFAULTS,
	SCENARIO_STAT_KEYS,
	ScenarioDocument,
	ScenarioStats,
} from "../models/Scenario";

const STAT_LABELS: Record<(typeof SCENARIO_STAT_KEYS)[number], string> = {
	level: "Level",
	partyBonus: "Party bonus %",
	countdown: "Countdown (s)",
	fps: "FPS tax (0 = off)",
};

// Party buffs are the buff types with timeline marker colors.
const PARTY_BUFFS: BuffType[] = Object.values(BuffType).filter(
	(b) => getBuffColor(b) !== undefined,
);

export function parseOptional(text: string): number | undefined {
	const x = Number(text);
	return text.trim() === "" || !Number.isFinite(x) ? undefined : x;
}

// Empty = not set (the placeholder shows the value used instead).
export function NumberInput(props: {
	value: number | undefined;
	placeholder?: string;
	label: string;
	onChange: (value: number | undefined) => void;
	step?: number;
}) {
	return <input
		type="number"
		step={props.step ?? 1}
		value={props.value ?? ""}
		placeholder={props.placeholder}
		aria-label={props.label}
		onChange={(e) => props.onChange(parseOptional(e.target.value))}
	/>;
}

export function ScenarioPanel(props: {
	job: ShellJob;
	scenario: ScenarioDocument;
	onChange: (scenario: ScenarioDocument) => void;
	// The current rotation's gear, shown above the shared scenario.
	gearPanel?: React.ReactNode;
}) {
	const { job, scenario, onChange } = props;
	const defaults = useMemo(() => makeDefaultConfig(job), [job]);
	const update = (patch: Partial<ScenarioDocument>) =>
		onChange({ ...scenario, ...patch, updatedAt: new Date().toISOString() });
	const setStat = (key: keyof ScenarioStats, value: number | undefined) => {
		const stats = { ...scenario.stats };
		if (value === undefined) delete stats[key];
		else (stats as Record<string, number>)[key] = value;
		update({ stats });
	};
	const endMode = typeof scenario.end === "number" ? "cutoff" : scenario.end;

	return <aside className="rl-scenario" aria-label="Scenario">
		{props.gearPanel}
		<h2>Scenario (shared)</h2>
		<div className="rl-field">
			<label htmlFor="rl-scenario-name">Name</label>
			<input
				id="rl-scenario-name"
				value={scenario.name}
				onChange={(e) => update({ name: e.target.value })}
			/>
		</div>

		{SCENARIO_STAT_KEYS.map((key) => <div className="rl-field" key={key}>
			<span>{STAT_LABELS[key]}</span>
			<NumberInput
				label={STAT_LABELS[key]}
				value={scenario.stats[key]}
				placeholder={String(SCENARIO_STAT_DEFAULTS[key] ?? defaults[key])}
				onChange={(v) => setStat(key, v)}
			/>
		</div>)}
		<div className="rl-field">
			<span>Gemdraught grade</span>
			<select
				aria-label="Gemdraught grade"
				value={scenario.tinctureGrade ?? 4}
				onChange={(e) => update({ tinctureGrade: Number(e.target.value) as 1 | 2 | 3 | 4 })}
			>
				{[4, 3, 2, 1].map((g) => <option key={g} value={g}>
					Grade {g}
				</option>)}
			</select>
		</div>

		<h2>Fight</h2>
		<div className="rl-field">
			<span>Simulate until</span>
			<select
				aria-label="Simulate until"
				value={endMode}
				onChange={(e) => {
					const mode = e.target.value;
					update({
						end: mode === "cutoff" ? 120 : (mode as "lastAction" | "settled"),
					});
				}}
			>
				<option value="settled">All damage lands</option>
				<option value="lastAction">Last action</option>
				<option value="cutoff">Fixed cutoff</option>
			</select>
		</div>
		{typeof scenario.end === "number" && <div className="rl-field">
			<span>Cutoff (s)</span>
			<NumberInput
				label="Cutoff"
				step={0.1}
				value={scenario.end}
				onChange={(v) => update({ end: v ?? 0 })}
			/>
		</div>}

		<h2>Party buffs</h2>
		{scenario.partyBuffs.map((w, i) => <div className="rl-window" key={i}>
			<select
				aria-label="Party buff"
				value={w.buff}
				onChange={(e) =>
					update({
						partyBuffs: scenario.partyBuffs.map((x, j) =>
							j === i ? { ...x, buff: e.target.value as BuffType } : x,
						),
					})
				}
			>
				{PARTY_BUFFS.map((b) => <option key={b} value={b}>
					{b}
				</option>)}
			</select>
			<NumberInput
				label="Buff start"
				step={0.1}
				value={w.time}
				onChange={(v) =>
					update({
						partyBuffs: scenario.partyBuffs.map((x, j) =>
							j === i ? { ...x, time: v ?? 0 } : x,
						),
					})
				}
			/>
			<button
				aria-label="Remove buff"
				onClick={() =>
					update({ partyBuffs: scenario.partyBuffs.filter((_, j) => j !== i) })
				}
			>
				×
			</button>
		</div>)}
		<button
			onClick={() =>
				update({
					partyBuffs: [
						...scenario.partyBuffs,
						{ buff: BuffType.TechnicalFinish, time: 0 },
					],
				})
			}
		>
			Add party buff
		</button>

		<h2>Downtime</h2>
		{scenario.downtime.map((w, i) => <div className="rl-window" key={i}>
			<NumberInput
				label="Downtime start"
				step={0.1}
				value={w.start}
				onChange={(v) =>
					update({
						downtime: scenario.downtime.map((x, j) =>
							j === i ? { ...x, start: v ?? 0 } : x,
						),
					})
				}
			/>
			to
			<NumberInput
				label="Downtime end"
				step={0.1}
				value={w.end}
				onChange={(v) =>
					update({
						downtime: scenario.downtime.map((x, j) =>
							j === i ? { ...x, end: v ?? 0 } : x,
						),
					})
				}
			/>
			<button
				aria-label="Remove downtime"
				onClick={() => update({ downtime: scenario.downtime.filter((_, j) => j !== i) })}
			>
				×
			</button>
		</div>)}
		<button
			onClick={() => update({ downtime: [...scenario.downtime, { start: 60, end: 70 }] })}
		>
			Add downtime
		</button>
	</aside>;
}
