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

// 2 → 3: rotations get a target count; every existing rotation was planned for one target.
function v2ToV3(workspace: Obj): Obj {
	const bump = (docs: unknown, extra: Obj = {}) =>
		Array.isArray(docs)
			? docs.map((doc) => (isObject(doc) ? { ...extra, ...doc, schemaVersion: 3 } : doc))
			: docs;
	return {
		...workspace,
		schemaVersion: 3,
		rotations: bump(workspace.rotations, { targetCount: 1 }),
		scenarios: bump(workspace.scenarios),
		gearSets: bump(workspace.gearSets),
	};
}

// 3 → 4: the target count is replaced by target ranges. The count was never editable (always 1),
// so it is dropped and every rotation starts with no extra targets.
function v3ToV4(workspace: Obj): Obj {
	const bump = (docs: unknown, change: (doc: Obj) => Obj = (doc) => doc) =>
		Array.isArray(docs)
			? docs.map((doc) => (isObject(doc) ? { ...change(doc), schemaVersion: 4 } : doc))
			: docs;
	return {
		...workspace,
		schemaVersion: 4,
		rotations: bump(workspace.rotations, (doc) => {
			const rest: Obj = { targets: [], ...doc };
			delete rest.targetCount;
			return rest;
		}),
		scenarios: bump(workspace.scenarios),
		gearSets: bump(workspace.gearSets),
	};
}

// 4 → 5: workspaces get stored comparisons. Earlier comparisons were never saved, so there are
// none to carry over.
function v4ToV5(workspace: Obj): Obj {
	const bump = (docs: unknown) =>
		Array.isArray(docs)
			? docs.map((doc) => (isObject(doc) ? { ...doc, schemaVersion: 5 } : doc))
			: docs;
	return {
		...workspace,
		schemaVersion: 5,
		rotations: bump(workspace.rotations),
		scenarios: bump(workspace.scenarios),
		gearSets: bump(workspace.gearSets),
		comparisons: [],
	};
}

const STEPS: Record<number, (workspace: Obj) => Obj> = {
	1: v1ToV2,
	2: v2ToV3,
	3: v3ToV4,
	4: v4ToV5,
};

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
