// Undo/redo over immutable snapshots. Rapid edits from the same source (e.g. typing in one input)
// are merged into a single step, so undo does not go back one keystroke at a time.

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;

export interface History<T> {
	past: T[];
	present: T;
	future: T[];
	// Source of the last recorded edit and when it happened, for coalescing.
	group?: unknown;
	at: number;
}

export function createHistory<T>(present: T): History<T> {
	return { past: [], present, future: [], at: 0 };
}

// Records `next` as the new present. With a `group` equal to the previous edit's, within
// COALESCE_MS, the edit replaces the present instead of adding a step.
export function record<T>(
	history: History<T>,
	next: T,
	group?: unknown,
	now = Date.now(),
): History<T> {
	if (next === history.present) return history;
	if (group !== undefined && group === history.group && now - history.at < COALESCE_MS) {
		return { ...history, present: next, at: now };
	}
	return {
		past: [...history.past, history.present].slice(-HISTORY_LIMIT),
		present: next,
		future: [],
		group,
		at: now,
	};
}

export function undo<T>(history: History<T>): History<T> {
	if (history.past.length === 0) return history;
	return {
		past: history.past.slice(0, -1),
		present: history.past[history.past.length - 1],
		future: [history.present, ...history.future],
		at: 0,
	};
}

export function redo<T>(history: History<T>): History<T> {
	if (history.future.length === 0) return history;
	return {
		past: [...history.past, history.present],
		present: history.future[0],
		future: history.future.slice(1),
		at: 0,
	};
}
