import { ShellJob } from "../../Game/Data/Jobs";
import { createGearSet, GEAR_STAT_KEYS } from "../models/GearSet";
import { SCHEMA_VERSION } from "../models/Rotation";

// Upgrades stored workspaces to the current SCHEMA_VERSION before validation. Each step takes the
// raw JSON of one version and returns the next; documents it cannot make sense of are passed
// through unchanged so validation reports them.

type Obj = Record<string, unknown>;
const isObject = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

// 1 → 2: character stats (and weapon delay) moved from scenarios into gear sets chosen per
// rotation. Each scenario's stats become a gear set named after it, and every rotation uses the
// first scenario's set (the one the editor opens by default), so results stay as they were.
function v1ToV2(workspace: Obj): Obj {
	const rotations = Array.isArray(workspace.rotations) ? workspace.rotations : [];
	const scenarios = Array.isArray(workspace.scenarios) ? workspace.scenarios : [];
	const firstJob = rotations.find(isObject)?.job;
	const job = typeof firstJob === "string" ? firstJob : "VPR";

	const gearSets: Obj[] = [];
	const migratedScenarios = scenarios.map((scenario) => {
		if (!isObject(scenario)) return scenario;
		const stats = isObject(scenario.stats) ? scenario.stats : {};
		const gearStats: Obj = {};
		const fightStats: Obj = {};
		for (const [key, value] of Object.entries(stats)) {
			if ((GEAR_STAT_KEYS as readonly string[]).includes(key)) gearStats[key] = value;
			else fightStats[key] = value;
		}
		const name = typeof scenario.name === "string" ? scenario.name : "Scenario";
		gearSets.push({
			// Unknown values are left for validation to report.
			...createGearSet({ job: job as ShellJob, name: `${name} gear`, stats: gearStats }),
			weaponDelay: scenario.weaponDelay,
		});
		const rest = { ...scenario };
		delete rest.weaponDelay;
		return { ...rest, schemaVersion: 2, stats: fightStats };
	});

	const defaultSet = gearSets[0]?.id;
	const migratedRotations = rotations.map((rotation) =>
		isObject(rotation) ? { ...rotation, schemaVersion: 2, gearSetId: defaultSet } : rotation,
	);
	return {
		...workspace,
		schemaVersion: 2,
		rotations: migratedRotations,
		scenarios: migratedScenarios,
		gearSets,
	};
}

const STEPS: Record<number, (workspace: Obj) => Obj> = { 1: v1ToV2 };

// Returns the workspace at SCHEMA_VERSION, or an error for versions it cannot upgrade.
export function migrateWorkspace(workspace: Obj): { workspace: Obj } | { error: string } {
	let current = workspace;
	while (current.schemaVersion !== SCHEMA_VERSION) {
		const step = STEPS[current.schemaVersion as number];
		if (!step) {
			return {
				error: `unsupported workspace schemaVersion ${JSON.stringify(current.schemaVersion)}`,
			};
		}
		current = step(current);
	}
	return { workspace: current };
}
