import { newId, RotationDocument, RotationEntry } from "../models/Rotation";
import { RotationStep, RotationResult, SimulatedAction, StepError } from "../simulation/types";

// Pure, immutable edits on a rotation. Every edit returns a new document with a fresh
// updatedAt, so React state updates and the simulation cache see the change.

function withEntries(rotation: RotationDocument, entries: RotationEntry[]): RotationDocument {
	return { ...rotation, entries, updatedAt: new Date().toISOString() };
}

function indexOfEntry(rotation: RotationDocument, id: string): number {
	return rotation.entries.findIndex((e) => e.id === id);
}

// Inserts after the entry `afterId`, or at the end when it is undefined or not found.
// Returns the ids of the new entries so the caller can select them.
export function insertSteps(
	rotation: RotationDocument,
	steps: RotationStep[],
	afterId?: string,
): { rotation: RotationDocument; insertedIds: string[] } {
	const index = afterId === undefined ? -1 : indexOfEntry(rotation, afterId);
	const at = index < 0 ? rotation.entries.length : index + 1;
	const inserted = steps.map((step) => ({ id: newId(), step }));
	const entries = [...rotation.entries.slice(0, at), ...inserted, ...rotation.entries.slice(at)];
	return { rotation: withEntries(rotation, entries), insertedIds: inserted.map((e) => e.id) };
}

export function removeEntry(rotation: RotationDocument, id: string): RotationDocument {
	return withEntries(
		rotation,
		rotation.entries.filter((e) => e.id !== id),
	);
}

// Moves an entry up (-1) or down (+1); a move past either end is a no-op.
export function moveEntry(rotation: RotationDocument, id: string, delta: -1 | 1): RotationDocument {
	const from = indexOfEntry(rotation, id);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= rotation.entries.length) {
		return rotation;
	}
	const entries = [...rotation.entries];
	[entries[from], entries[to]] = [entries[to], entries[from]];
	return withEntries(rotation, entries);
}

// Moves an entry so that it ends up before the entry currently at `beforeIndex`
// (entries.length = to the end), as when dropping it between two rows.
export function moveEntryBefore(
	rotation: RotationDocument,
	id: string,
	beforeIndex: number,
): RotationDocument {
	const from = indexOfEntry(rotation, id);
	if (from < 0 || beforeIndex < 0 || beforeIndex > rotation.entries.length) {
		return rotation;
	}
	const to = beforeIndex > from ? beforeIndex - 1 : beforeIndex;
	if (to === from) {
		return rotation;
	}
	const entries = [...rotation.entries];
	const [entry] = entries.splice(from, 1);
	entries.splice(to, 0, entry);
	return withEntries(rotation, entries);
}

export function duplicateEntry(
	rotation: RotationDocument,
	id: string,
): { rotation: RotationDocument; insertedIds: string[] } {
	const entry = rotation.entries.find((e) => e.id === id);
	if (!entry) {
		return { rotation, insertedIds: [] };
	}
	return insertSteps(rotation, [structuredClone(entry.step)], id);
}

export function updateStep(
	rotation: RotationDocument,
	id: string,
	step: RotationStep,
): RotationDocument {
	return withEntries(
		rotation,
		rotation.entries.map((e) => (e.id === id ? { ...e, step } : e)),
	);
}

// The id of the entry next to `id` after it is removed, so selection can stay in place.
export function neighbourAfterRemoval(rotation: RotationDocument, id: string): string | undefined {
	const index = indexOfEntry(rotation, id);
	if (index < 0) return undefined;
	return (rotation.entries[index + 1] ?? rotation.entries[index - 1])?.id;
}

export interface EditorRow {
	entry: RotationEntry;
	index: number;
	// Present for skill steps once simulated.
	action?: SimulatedAction;
	// Present for steps the simulator rejected (e.g. a jump to a time already passed).
	error?: StepError;
}

// Joins each entry with its simulated action or error, by step index.
export function buildRows(rotation: RotationDocument, result?: RotationResult): EditorRow[] {
	const actions = new Map(result?.actions.map((a) => [a.stepIndex, a]));
	const errors = new Map(result?.errors.map((e) => [e.stepIndex, e]));
	return rotation.entries.map((entry, index) => ({
		entry,
		index,
		action: actions.get(index),
		error: errors.get(index),
	}));
}
