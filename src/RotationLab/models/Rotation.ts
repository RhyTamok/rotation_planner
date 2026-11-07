import { ShellJob } from "../../Game/Data/Jobs";
import { ActionKey } from "../../Game/Data";
import { RotationStep, TargetRange } from "../simulation/types";
import type { GearOverrides } from "./GearSet";

// Version of the persisted document format. Bump it and add a migration in
// storage/migrations.ts whenever the shape of a stored document changes.
// 1 → 2: character stats moved from scenarios into gear sets chosen per rotation.
// 2 → 3: rotations have a target count (used by the action recommendations).
// 3 → 4: the target count is replaced by target ranges (used by damage and recommendations).
// 4 → 5: workspaces have stored comparisons.
// 5 → 6: comparisons have analysis settings (threshold, intervals, graph unit).
export const SCHEMA_VERSION = 6;

export type CombatMode = "reborn" | "evolved";

// Identifies the game rules a rotation was built for. `version` is maintained by Rotation Lab
// (the engine has no game patch identifier): bump it whenever job mechanics or potency data
// change, so saved results are never silently reinterpreted under different rules.
export interface Ruleset {
	mode: CombatMode;
	version: string;
}

// The rulesets this build can simulate. Evolved has no implementation yet.
export const AVAILABLE_RULESETS: Readonly<Record<CombatMode, string | undefined>> = {
	// dt-2: multi-target damage (target ranges, AoE falloff, boss debuffs on the main target only).
	reborn: "reborn-dt-2",
	evolved: undefined,
};

export function currentRuleset(mode: CombatMode = "reborn"): Ruleset {
	const version = AVAILABLE_RULESETS[mode];
	if (version === undefined) {
		throw new Error(`No ruleset is available for combat mode "${mode}"`);
	}
	return { mode, version };
}

// Entries carry stable ids so editors can track rows across insertions and reorders.
export interface RotationEntry {
	id: string;
	step: RotationStep;
}

export interface RotationDocument {
	schemaVersion: number;
	id: string;
	name: string;
	job: ShellJob;
	ruleset: Ruleset;
	entries: RotationEntry[];
	// The gear set this rotation is simulated with; missing = the job's default stats.
	gearSetId?: string;
	// Manual changes on top of the gear set.
	gearOverrides?: GearOverrides;
	// Times with more than one enemy (rules/targets.ts); empty = the main target only. Used by the
	// damage calculation and the action recommendations.
	targets: TargetRange[];
	// ISO 8601 timestamp of the last edit.
	updatedAt: string;
}

export function newId(): string {
	return crypto.randomUUID();
}

export function createRotation(props: {
	name: string;
	job: ShellJob;
	steps: (ActionKey | RotationStep)[];
	mode?: CombatMode;
	gearSetId?: string;
	targets?: TargetRange[];
}): RotationDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId(),
		name: props.name,
		job: props.job,
		ruleset: currentRuleset(props.mode),
		gearSetId: props.gearSetId,
		targets: props.targets?.map((r) => ({ ...r })) ?? [],
		entries: props.steps.map((step) => ({
			id: newId(),
			step: typeof step === "string" ? { type: "skill", action: step } : step,
		})),
		updatedAt: new Date().toISOString(),
	};
}
