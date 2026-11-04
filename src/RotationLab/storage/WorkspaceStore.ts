import { ComparisonDocument } from "../models/Comparison";
import { GearSetDocument } from "../models/GearSet";
import { newId, RotationDocument, SCHEMA_VERSION } from "../models/Rotation";
import { ScenarioDocument } from "../models/Scenario";
import {
	parseComparisonDocument,
	parseGearSetDocument,
	parseRotationDocument,
	parseScenarioDocument,
} from "../models/validation";
import { migrateWorkspace } from "./migrations";

// Local-first persistence: one JSON workspace in browser storage, plus export/import as text
// for files. No backend.

export interface Workspace {
	schemaVersion: number;
	rotations: RotationDocument[];
	scenarios: ScenarioDocument[];
	gearSets: GearSetDocument[];
	comparisons: ComparisonDocument[];
}

// The subset of the Web Storage API used here, so tests can supply an in-memory store.
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export const WORKSPACE_KEY = "rotationLab.workspace";
// Unreadable workspaces are copied here before anything can overwrite them.
export const CORRUPT_BACKUP_KEY = "rotationLab.workspace.corrupt";

export function emptyWorkspace(): Workspace {
	return {
		schemaVersion: SCHEMA_VERSION,
		rotations: [],
		scenarios: [],
		gearSets: [],
		comparisons: [],
	};
}

export interface WorkspaceParseResult {
	workspace: Workspace;
	// Documents or whole files that were skipped, with reasons.
	errors: string[];
	// Set when the text was in an older schema version and has been upgraded.
	migratedFrom?: number;
}

// Keeps every valid document and reports the invalid ones, so one bad rotation does not make
// the rest of a file unusable.
export function parseWorkspace(text: string): WorkspaceParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { workspace: emptyWorkspace(), errors: [`not valid JSON: ${(e as Error).message}`] };
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { workspace: emptyWorkspace(), errors: ["workspace must be an object"] };
	}
	const migrated = migrateWorkspace(raw as Record<string, unknown>);
	if ("error" in migrated) {
		return { workspace: emptyWorkspace(), errors: [migrated.error] };
	}
	const obj = migrated.workspace;

	const errors: string[] = [];
	const workspace = emptyWorkspace();
	const collect = <T>(
		list: unknown,
		label: string,
		parse: (x: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
		into: T[],
	) => {
		if (!Array.isArray(list)) {
			errors.push(`${label}s must be an array`);
			return;
		}
		list.forEach((item, i) => {
			const parsed = parse(item);
			if (parsed.ok) {
				into.push(parsed.value);
			} else {
				const name = (item as { name?: unknown })?.name;
				const id = typeof name === "string" ? `"${name}"` : `#${i}`;
				errors.push(`${label} ${id} skipped: ${parsed.errors.join("; ")}`);
			}
		});
	};
	collect(obj.rotations, "rotation", parseRotationDocument, workspace.rotations);
	collect(obj.scenarios, "scenario", parseScenarioDocument, workspace.scenarios);
	collect(obj.gearSets, "gear set", parseGearSetDocument, workspace.gearSets);
	// Last: a comparison needs the rotations and scenario it refers to to have been accepted.
	collect(
		obj.comparisons,
		"comparison",
		(item) => parseComparisonDocument(item, workspace),
		workspace.comparisons,
	);
	const version = (raw as Record<string, unknown>).schemaVersion;
	return version === SCHEMA_VERSION
		? { workspace, errors }
		: { workspace, errors, migratedFrom: version as number };
}

// Adds an imported workspace to the current one without overwriting anything: clashing ids get
// fresh ones, and the documents that refer to them follow.
export function mergeWorkspace(current: Workspace, imported: Workspace): Workspace {
	const freshIds = (docs: { id: string }[], existing: { id: string }[]) =>
		new Map(docs.map((d) => [d.id, existing.some((x) => x.id === d.id) ? newId() : d.id]));
	const rotationIds = freshIds(imported.rotations, current.rotations);
	const scenarioIds = freshIds(imported.scenarios, current.scenarios);
	const gearIds = freshIds(imported.gearSets, current.gearSets);
	const comparisonIds = freshIds(imported.comparisons, current.comparisons);
	return {
		...current,
		rotations: [
			...current.rotations,
			...imported.rotations.map((r) => ({
				...r,
				id: rotationIds.get(r.id)!,
				gearSetId: r.gearSetId && (gearIds.get(r.gearSetId) ?? r.gearSetId),
			})),
		],
		gearSets: [
			...current.gearSets,
			...imported.gearSets.map((g) => ({ ...g, id: gearIds.get(g.id)! })),
		],
		scenarios: [
			...current.scenarios,
			...imported.scenarios.map((s) => ({ ...s, id: scenarioIds.get(s.id)! })),
		],
		comparisons: [
			...current.comparisons,
			...imported.comparisons.map((c) => ({
				...c,
				id: comparisonIds.get(c.id)!,
				scenarioId: scenarioIds.get(c.scenarioId)!,
				configurations: c.configurations.map((x) => ({
					...x,
					rotationId: rotationIds.get(x.rotationId)!,
				})),
			})),
		],
	};
}

export function serializeWorkspace(workspace: Workspace): string {
	return JSON.stringify(workspace, null, 2);
}

export function loadWorkspace(storage: KeyValueStorage = localStorage): WorkspaceParseResult {
	const text = storage.getItem(WORKSPACE_KEY);
	if (text === null) {
		return { workspace: emptyWorkspace(), errors: [] };
	}
	const parsed = parseWorkspace(text);
	if (parsed.errors.length > 0) {
		// Keep the original text so a later save cannot destroy recoverable data.
		storage.setItem(CORRUPT_BACKUP_KEY, text);
	}
	if (parsed.migratedFrom !== undefined) {
		// The next save overwrites the old format; keep it in case the upgrade needs revisiting.
		storage.setItem(`${WORKSPACE_KEY}.v${parsed.migratedFrom}`, text);
	}
	return parsed;
}

export function saveWorkspace(workspace: Workspace, storage: KeyValueStorage = localStorage) {
	storage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
}
