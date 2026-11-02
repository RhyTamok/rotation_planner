import React, { useMemo, useState } from "react";

import { ShellJob } from "../../Game/Data/Jobs";
import { GameConfig, makeDefaultConfig } from "../../Game/GameConfig";
import { getDefaultWeaponDelay } from "../damage/DamageModel";
import {
	createGearSet,
	GEAR_STAT_KEYS,
	GearOverrides,
	GearSetDocument,
	GearStatKey,
	GearStats,
	resolveGear,
} from "../models/GearSet";
import { newId, RotationDocument } from "../models/Rotation";
import { importFromXivgear } from "../import/xivgear";
import { formatNumber } from "./format";
import { NumberInput } from "./ScenarioPanel";

const GEAR_LABELS: Record<GearStatKey, string> = {
	main: "Main stat",
	wd: "Weapon damage",
	criticalHit: "Critical hit",
	directHit: "Direct hit",
	determination: "Determination",
	skillSpeed: "Skill speed",
	tenacity: "Tenacity",
};

const now = () => new Date().toISOString();

function withStat(stats: GearStats, key: GearStatKey, value: number | undefined): GearStats {
	const next = { ...stats };
	if (value === undefined) delete next[key];
	else next[key] = value;
	return next;
}

// The 2.5 s base GCD at the given skill speed and level, before any haste buff.
function baseGcd(job: ShellJob, level: number, stats: GearStats): number {
	const config = new GameConfig({ ...makeDefaultConfig(job), ...stats, level, job });
	return config.adjustedSksGCD(2.5);
}

function XivgearImportForm(props: {
	job: ShellJob;
	level: number;
	onImported: (gearSets: GearSetDocument[]) => void;
	fetchFn?: typeof fetch;
}) {
	const [link, setLink] = useState("");
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<{ text: string; error: boolean }>();

	const run = async () => {
		setBusy(true);
		setStatus(undefined);
		try {
			const result = await importFromXivgear(link, props.job, props.fetchFn);
			props.onImported(result.gearSets);
			const notes = [...result.warnings];
			if (result.level !== undefined && result.level !== props.level) {
				notes.push(
					`the sheet is for level ${result.level}, the scenario uses ${props.level}`,
				);
			}
			const names = result.gearSets.map((g) => g.name).join(", ");
			setStatus({
				text:
					`Imported ${result.gearSets.length} gear set(s): ${names}.` +
					(notes.length > 0 ? ` Note: ${notes.join("; ")}.` : ""),
				error: false,
			});
			setLink("");
		} catch (e) {
			setStatus({ text: (e as Error).message, error: true });
		} finally {
			setBusy(false);
		}
	};

	return <div className="rl-xivgear">
		<div className="rl-gear-actions">
			<input
				aria-label="xivgear link"
				placeholder="xivgear.app link (set or sheet)"
				value={link}
				onChange={(e) => setLink(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && link.trim() && !busy) void run();
				}}
			/>
			<button disabled={busy || !link.trim()} onClick={() => void run()}>
				{busy ? "Importing…" : "Import"}
			</button>
		</div>
		{status && <p className={`rl-note ${status.error ? "rl-error" : ""}`} role="status">
			{status.text}
		</p>}
	</div>;
}

// The current rotation's gear: which set it uses, that set's values, and this rotation's own
// overrides on top. Editing a set changes every rotation that uses it.
export function GearPanel(props: {
	job: ShellJob;
	level: number;
	rotation: RotationDocument;
	gearSets: GearSetDocument[];
	onRotationChange: (rotation: RotationDocument) => void;
	onGearSetsChange: (gearSets: GearSetDocument[]) => void;
}) {
	const { job, level, rotation, gearSets, onRotationChange, onGearSetsChange } = props;
	const defaults = useMemo(() => makeDefaultConfig(job), [job]);
	const set = gearSets.find((g) => g.id === rotation.gearSetId);
	const resolved = resolveGear(rotation, gearSets);
	const gcd = baseGcd(job, level, resolved.stats);

	const setRotation = (patch: Partial<RotationDocument>) =>
		onRotationChange({ ...rotation, ...patch, updatedAt: now() });
	const updateSet = (patch: Partial<GearSetDocument>) =>
		set &&
		onGearSetsChange(
			gearSets.map((g) => (g.id === set.id ? { ...g, ...patch, updatedAt: now() } : g)),
		);
	const addSet = (doc: GearSetDocument) => {
		onGearSetsChange([...gearSets, doc]);
		setRotation({ gearSetId: doc.id });
	};
	const overrides: GearOverrides = rotation.gearOverrides ?? { stats: {} };
	const setOverrides = (next: GearOverrides) =>
		setRotation({
			gearOverrides:
				Object.keys(next.stats).length === 0 && next.weaponDelay === undefined
					? undefined
					: next,
		});
	const overrideCount =
		Object.keys(overrides.stats).length + (overrides.weaponDelay === undefined ? 0 : 1);

	return <section aria-label="Rotation gear">
		<h2>Rotation gear</h2>
		<div className="rl-field">
			<span>Gear set</span>
			<select
				aria-label="Gear set"
				value={set?.id ?? ""}
				onChange={(e) => setRotation({ gearSetId: e.target.value || undefined })}
			>
				<option value="">Job defaults</option>
				{gearSets.map((g) => <option key={g.id} value={g.id}>
					{g.name || "(unnamed)"}
				</option>)}
			</select>
		</div>
		<div className="rl-gear-actions">
			<button onClick={() => addSet(createGearSet({ job, name: "New gear set" }))}>
				New set
			</button>
			{set && <>
				<button
					onClick={() =>
						addSet({ ...structuredClone(set), id: newId(), name: `${set.name} (copy)` })
					}
				>
					Duplicate
				</button>
				<button
					title="Rotations using this set fall back to the job defaults"
					onClick={() => {
						onGearSetsChange(gearSets.filter((g) => g.id !== set.id));
						setRotation({ gearSetId: undefined });
					}}
				>
					Delete
				</button>
			</>}
		</div>
		<XivgearImportForm
			job={job}
			level={level}
			onImported={(imported) => {
				onGearSetsChange([...gearSets, ...imported]);
				// A single set is clearly meant for this rotation; sheets just add their sets.
				if (imported.length === 1) setRotation({ gearSetId: imported[0].id });
			}}
		/>
		<p className="rl-note">
			GCD {formatNumber(gcd, 2)} s
			{overrideCount > 0 &&
				` · ${overrideCount} override${overrideCount > 1 ? "s" : ""} on this rotation`}
		</p>

		{set && <>
			<div className="rl-field">
				<label htmlFor="rl-gear-name">Set name</label>
				<input
					id="rl-gear-name"
					value={set.name}
					onChange={(e) => updateSet({ name: e.target.value })}
				/>
			</div>
			{GEAR_STAT_KEYS.map((key) => <div className="rl-field" key={key}>
				<span>{GEAR_LABELS[key]}</span>
				<NumberInput
					label={GEAR_LABELS[key]}
					value={set.stats[key]}
					placeholder={String(defaults[key])}
					onChange={(v) => updateSet({ stats: withStat(set.stats, key, v) })}
				/>
			</div>)}
			<div className="rl-field">
				<span>Weapon delay (s)</span>
				<NumberInput
					label="Weapon delay"
					step={0.01}
					value={set.weaponDelay}
					placeholder={String(getDefaultWeaponDelay(job) ?? "")}
					onChange={(v) =>
						updateSet({ weaponDelay: v !== undefined && v > 0 ? v : undefined })
					}
				/>
			</div>
		</>}

		<details className="rl-overrides" open={overrideCount > 0}>
			<summary>Overrides for this rotation</summary>
			{GEAR_STAT_KEYS.map((key) => <div className="rl-field" key={key}>
				<span>{GEAR_LABELS[key]}</span>
				<NumberInput
					label={`Override ${GEAR_LABELS[key]}`}
					value={overrides.stats[key]}
					placeholder={String(set?.stats[key] ?? defaults[key])}
					onChange={(v) =>
						setOverrides({ ...overrides, stats: withStat(overrides.stats, key, v) })
					}
				/>
			</div>)}
			<div className="rl-field">
				<span>Weapon delay (s)</span>
				<NumberInput
					label="Override weapon delay"
					step={0.01}
					value={overrides.weaponDelay}
					placeholder={String(set?.weaponDelay ?? getDefaultWeaponDelay(job) ?? "")}
					onChange={(v) =>
						setOverrides({
							...overrides,
							weaponDelay: v !== undefined && v > 0 ? v : undefined,
						})
					}
				/>
			</div>
		</details>
	</section>;
}
