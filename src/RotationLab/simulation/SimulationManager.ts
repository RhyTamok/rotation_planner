import { AVAILABLE_RULESETS, RotationDocument, Ruleset } from "../models/Rotation";
import { ScenarioDocument, scenarioToOptions } from "../models/Scenario";
import { simulateRotation } from "./RotationSimulator";
import { RotationResult } from "./types";

export interface DocumentSimulation {
	result: RotationResult;
	// Set when the rotation was saved under a different ruleset version than this build
	// simulates; the result reflects the current rules, not the saved ones.
	rulesetMismatch?: { saved: Ruleset; current: Ruleset };
}

export function simulateDocument(
	rotation: RotationDocument,
	scenario: ScenarioDocument,
): DocumentSimulation {
	const currentVersion = AVAILABLE_RULESETS[rotation.ruleset.mode];
	if (currentVersion === undefined) {
		throw new Error(`Combat mode "${rotation.ruleset.mode}" cannot be simulated yet`);
	}
	const result = simulateRotation(
		{ id: rotation.id, steps: rotation.entries.map((e) => e.step) },
		scenarioToOptions(scenario),
		rotation.job,
	);
	return rotation.ruleset.version === currentVersion
		? { result }
		: {
				result,
				rulesetMismatch: {
					saved: { ...rotation.ruleset },
					current: { mode: rotation.ruleset.mode, version: currentVersion },
				},
			};
}

// JSON with object keys sorted at every level, so equal inputs always give equal strings.
export function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v !== null && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: v,
	);
}

// Everything that can change a simulation's outcome, and nothing else: names, document ids,
// entry ids and timestamps are excluded so renaming or re-saving does not invalidate results.
export function simulationKey(rotation: RotationDocument, scenario: ScenarioDocument): string {
	return stableStringify({
		job: rotation.job,
		ruleset: rotation.ruleset,
		steps: rotation.entries.map((e) => e.step),
		scenario: scenarioToOptions(scenario),
	});
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		Object.values(value).forEach(deepFreeze);
	}
	return value;
}

// Memoizes simulations so that editing one rotation does not re-simulate the others.
// Cached results are deeply frozen and shared between callers; do not mutate them.
export class SimulationCache {
	readonly #maxEntries: number;
	readonly #simulate: typeof simulateDocument;
	// Map iteration order doubles as least-recently-used order.
	readonly #entries = new Map<string, DocumentSimulation>();

	constructor(maxEntries = 64, simulate: typeof simulateDocument = simulateDocument) {
		this.#maxEntries = maxEntries;
		this.#simulate = simulate;
	}

	get size(): number {
		return this.#entries.size;
	}

	get(rotation: RotationDocument, scenario: ScenarioDocument): DocumentSimulation {
		const key = simulationKey(rotation, scenario);
		let entry = this.#entries.get(key);
		if (entry) {
			this.#entries.delete(key);
		} else {
			entry = deepFreeze(this.#simulate(rotation, scenario));
			if (this.#entries.size >= this.#maxEntries) {
				this.#entries.delete(this.#entries.keys().next().value!);
			}
		}
		this.#entries.set(key, entry);
		// Identical rotations share a cached result; report it under the caller's rotation id.
		return entry.result.id === rotation.id
			? entry
			: { ...entry, result: { ...entry.result, id: rotation.id } };
	}

	clear() {
		this.#entries.clear();
	}
}
