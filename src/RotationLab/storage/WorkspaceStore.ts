import { RotationDocument, SCHEMA_VERSION } from "../models/Rotation";
import { ScenarioDocument } from "../models/Scenario";
import { parseRotationDocument, parseScenarioDocument } from "../models/validation";

// Local-first persistence: one JSON workspace in browser storage, plus export/import as text
// for files. No backend.

export interface Workspace {
	schemaVersion: number;
	rotations: RotationDocument[];
	scenarios: ScenarioDocument[];
}

// The subset of the Web Storage API used here, so tests can supply an in-memory store.
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export const WORKSPACE_KEY = "rotationLab.workspace";
// Unreadable workspaces are copied here before anything can overwrite them.
export const CORRUPT_BACKUP_KEY = "rotationLab.workspace.corrupt";

export function emptyWorkspace(): Workspace {
	return { schemaVersion: SCHEMA_VERSION, rotations: [], scenarios: [] };
}

export interface WorkspaceParseResult {
	workspace: Workspace;
	// Documents or whole files that were skipped, with reasons.
	errors: string[];
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
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== SCHEMA_VERSION) {
		return {
			workspace: emptyWorkspace(),
			errors: [`unsupported workspace schemaVersion ${JSON.stringify(obj.schemaVersion)}`],
		};
	}

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
	return { workspace, errors };
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
	return parsed;
}

export function saveWorkspace(workspace: Workspace, storage: KeyValueStorage = localStorage) {
	storage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
}
