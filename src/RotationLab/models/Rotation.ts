import { ShellJob } from "../../Game/Data/Jobs";
import { ActionKey } from "../../Game/Data";
import { RotationStep } from "../simulation/types";

// Version of the persisted document format. Bump it and add a migration in validation.ts
// whenever the shape of RotationDocument or ScenarioDocument changes.
export const SCHEMA_VERSION = 1;

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
	reborn: "reborn-dt-1",
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
}): RotationDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId(),
		name: props.name,
		job: props.job,
		ruleset: currentRuleset(props.mode),
		entries: props.steps.map((step) => ({
			id: newId(),
			step: typeof step === "string" ? { type: "skill", action: step } : step,
		})),
		updatedAt: new Date().toISOString(),
	};
}
