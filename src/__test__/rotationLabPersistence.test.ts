import { describe, expect, it } from "vitest";

import { BuffType } from "../Game/Common";
import { ActionKey } from "../Game/Data";
import {
	AVAILABLE_RULESETS,
	createRotation,
	RotationDocument,
	SCHEMA_VERSION,
} from "../RotationLab/models/Rotation";
import {
	createScenario,
	ScenarioDocument,
	scenarioToOptions,
} from "../RotationLab/models/Scenario";
import {
	parseGearSetDocument,
	parseRotationDocument,
	parseScenarioDocument,
} from "../RotationLab/models/validation";
import { createGearSet, resolveGear } from "../RotationLab/models/GearSet";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import {
	SimulationCache,
	simulateDocument,
	simulationKey,
	stableStringify,
} from "../RotationLab/simulation/SimulationManager";
import {
	CORRUPT_BACKUP_KEY,
	KeyValueStorage,
	loadWorkspace,
	parseWorkspace,
	saveWorkspace,
	serializeWorkspace,
	WORKSPACE_KEY,
} from "../RotationLab/storage/WorkspaceStore";

const FILLER: ActionKey[] = ["STEEL_FANGS", "STEEL_FANGS", "STEEL_FANGS"];

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
	};
}

function errorsOf(result: { ok: boolean; errors?: string[] }): string {
	return (result.errors ?? []).join("\n");
}

describe("Rotation Lab - rotation documents", () => {
	it("creates valid documents with unique entry ids and the current ruleset", () => {
		const rotation = createRotation({
			name: "Filler",
			job: "VPR",
			steps: ["TINCTURE", ...FILLER, { type: "wait", seconds: 1 }],
		});
		const parsed = parseRotationDocument(JSON.parse(JSON.stringify(rotation)));

		expect(parsed.ok, errorsOf(parsed)).toBe(true);
		expect(rotation.schemaVersion).toBe(SCHEMA_VERSION);
		expect(rotation.ruleset).toEqual({ mode: "reborn", version: AVAILABLE_RULESETS.reborn });
		expect(new Set(rotation.entries.map((e) => e.id)).size).toBe(rotation.entries.length);
		expect(rotation.entries[0].step).toEqual({ type: "skill", action: "TINCTURE" });
	});

	it("cannot create a rotation for a combat mode without a ruleset", () => {
		expect(() =>
			createRotation({ name: "x", job: "VPR", steps: [], mode: "evolved" }),
		).toThrow();
	});

	it("rejects invalid documents with readable errors", () => {
		const valid = createRotation({ name: "ok", job: "VPR", steps: FILLER });
		const cases: [string, (doc: RotationDocument) => unknown][] = [
			["schemaVersion", (d) => ({ ...d, schemaVersion: 99 })],
			["targetCount", (d) => ({ ...d, targetCount: 0 })],
			["unknown job", (d) => ({ ...d, job: "XYZ" })],
			[
				"not a VPR action",
				(d) => ({
					...d,
					entries: [{ id: "a", step: { type: "skill", action: "TRUE_THRUST" } }],
				}),
			],
			[
				"non-negative",
				(d) => ({ ...d, entries: [{ id: "a", step: { type: "wait", seconds: -1 } }] }),
			],
			[
				"unknown step type",
				(d) => ({ ...d, entries: [{ id: "a", step: { type: "dance" } }] }),
			],
			["duplicate entry id", (d) => ({ ...d, entries: [d.entries[0], d.entries[0]] })],
			[
				"targets",
				(d) => ({
					...d,
					entries: [
						{ id: "a", step: { type: "skill", action: "STEEL_FANGS", targets: [0] } },
					],
				}),
			],
			["ruleset", (d) => ({ ...d, ruleset: { mode: "classic" } })],
		];
		for (const [expectedError, mutate] of cases) {
			const parsed = parseRotationDocument(mutate(valid));
			expect(parsed.ok, expectedError).toBe(false);
			expect(errorsOf(parsed)).toContain(expectedError);
		}
	});
});

describe("Rotation Lab - scenario documents", () => {
	it("accepts a full scenario and converts it to simulation options", () => {
		const scenario = createScenario({
			name: "Raid",
			stats: { level: 100 },
			tinctureGrade: 3,
			partyBuffs: [{ buff: BuffType.TechnicalFinish, time: 7 }],
			downtime: [{ start: 60, end: 70 }],
			end: 120,
		});
		const parsed = parseScenarioDocument(JSON.parse(JSON.stringify(scenario)));

		expect(parsed.ok, errorsOf(parsed)).toBe(true);
		// Character stats come from the rotation's gear, merged over the scenario's settings.
		const gear = { stats: { main: 6000, criticalHit: 3000 }, weaponDelay: 2.64 };
		expect(scenarioToOptions(scenario, gear)).toEqual({
			// fps 0: scenarios use nominal GCD lengths unless an FPS is set.
			config: { fps: 0, main: 6000, criticalHit: 3000, level: 100 },
			weaponDelay: 2.64,
			tinctureGrade: 3,
			partyBuffs: [{ buff: BuffType.TechnicalFinish, time: 7 }],
			downtime: [{ start: 60, end: 70 }],
			end: 120,
			encounterRules: true,
		});
	});

	it("rejects invalid scenarios with readable errors", () => {
		const valid = createScenario();
		const cases: [string, (doc: ScenarioDocument) => unknown][] = [
			["not a supported stat", (d) => ({ ...d, stats: { piety: 500 } })],
			["stats.level", (d) => ({ ...d, stats: { level: 85 } })],
			["not a party buff", (d) => ({ ...d, partyBuffs: [{ buff: BuffType.Fuka, time: 0 }] })],
			["end after start", (d) => ({ ...d, downtime: [{ start: 10, end: 5 }] })],
			["end must be", (d) => ({ ...d, end: "never" })],
			["tinctureGrade", (d) => ({ ...d, tinctureGrade: 5 })],
			// Character stats now belong to gear sets.
			["stats.main is not a supported stat", (d) => ({ ...d, stats: { main: 6000 } })],
		];
		for (const [expectedError, mutate] of cases) {
			const parsed = parseScenarioDocument(mutate(valid));
			expect(parsed.ok, expectedError).toBe(false);
			expect(errorsOf(parsed)).toContain(expectedError);
		}
	});
});

describe("Rotation Lab - simulating documents", () => {
	const scenario = createScenario({
		stats: { partyBonus: 3 },
		partyBuffs: [{ buff: BuffType.TechnicalFinish, time: -10 }],
		end: 15,
	});

	it("gives the same result as simulating the steps directly", () => {
		const rotation = createRotation({ name: "Filler", job: "VPR", steps: FILLER });
		const { result, rulesetMismatch } = simulateDocument(rotation, scenario);

		expect(rulesetMismatch).toBeUndefined();
		expect(result).toEqual(
			simulateRotation({ id: rotation.id, steps: FILLER }, scenarioToOptions(scenario)),
		);
	});

	it("reports rotations saved under a different ruleset version", () => {
		const rotation = createRotation({ name: "Old", job: "VPR", steps: FILLER });
		rotation.ruleset = { mode: "reborn", version: "reborn-old" };

		expect(simulateDocument(rotation, scenario).rulesetMismatch).toEqual({
			saved: { mode: "reborn", version: "reborn-old" },
			current: { mode: "reborn", version: AVAILABLE_RULESETS.reborn },
		});
	});

	it("refuses to simulate a combat mode that is not implemented", () => {
		const rotation = createRotation({ name: "Evolved", job: "VPR", steps: FILLER });
		rotation.ruleset = { mode: "evolved", version: "evolved-1" };

		expect(() => simulateDocument(rotation, scenario)).toThrow();
	});
});

describe("Rotation Lab - simulation cache", () => {
	function countingCache(maxEntries?: number) {
		const calls = { count: 0 };
		const cache = new SimulationCache(maxEntries, (rotation, scenario) => {
			calls.count++;
			return simulateDocument(rotation, scenario);
		});
		return { cache, calls };
	}

	it("produces key-order-independent strings", () => {
		expect(stableStringify({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: 3 } })).toBe(
			stableStringify({ a: { c: 3, d: [2, { x: 2, y: 1 }] }, b: 1 }),
		);
	});

	it("reuses results until a simulation input changes", () => {
		const { cache, calls } = countingCache();
		const rotation = createRotation({ name: "A", job: "VPR", steps: FILLER });
		const scenario = createScenario({ end: 15 });

		const first = cache.get(rotation, scenario);
		// Renaming, re-saving and fresh entry ids do not change the simulation.
		const renamed = {
			...rotation,
			name: "Renamed",
			updatedAt: new Date(0).toISOString(),
			entries: rotation.entries.map((e) => ({ ...e, id: e.id + "-copy" })),
		};
		expect(cache.get(renamed, { ...scenario, name: "Other name" })).toBe(first);
		expect(calls.count).toBe(1);

		cache.get(rotation, scenario, { stats: { main: 6500 } });
		cache.get(rotation, { ...scenario, downtime: [{ start: 1, end: 2 }] });
		cache.get({ ...rotation, entries: rotation.entries.slice(1) }, scenario);
		expect(calls.count).toBe(4);
	});

	it("reports a shared result under each caller's rotation id", () => {
		const { cache, calls } = countingCache();
		const a = createRotation({ name: "A", job: "VPR", steps: FILLER });
		const b = createRotation({ name: "B", job: "VPR", steps: FILLER });
		const scenario = createScenario({ end: 15 });

		expect(cache.get(a, scenario).result.id).toBe(a.id);
		expect(cache.get(b, scenario).result.id).toBe(b.id);
		expect(calls.count).toBe(1);
	});

	it("evicts the least recently used result and freezes cached results", () => {
		const { cache, calls } = countingCache(2);
		const scenario = createScenario({ end: 10 });
		const r1 = createRotation({ name: "1", job: "VPR", steps: FILLER.slice(0, 1) });
		const r2 = createRotation({ name: "2", job: "VPR", steps: FILLER.slice(0, 2) });
		const r3 = createRotation({ name: "3", job: "VPR", steps: FILLER });

		const cached = cache.get(r1, scenario);
		expect(Object.isFrozen(cached.result.actions[0])).toBe(true);
		cache.get(r2, scenario);
		cache.get(r1, scenario); // r1 becomes most recently used
		cache.get(r3, scenario); // evicts r2
		expect(cache.size).toBe(2);
		expect(calls.count).toBe(3);

		cache.get(r1, scenario);
		expect(calls.count).toBe(3);
		cache.get(r2, scenario);
		expect(calls.count).toBe(4);
		expect(simulationKey(r1, scenario)).not.toBe(simulationKey(r2, scenario));
	});
});

describe("Rotation Lab - workspace storage", () => {
	function sampleWorkspace() {
		const gear = createGearSet({ job: "VPR", name: "2.50", stats: { skillSpeed: 420 } });
		return {
			schemaVersion: SCHEMA_VERSION,
			rotations: [
				createRotation({
					name: "Opener",
					job: "VPR" as const,
					steps: FILLER,
					gearSetId: gear.id,
				}),
			],
			scenarios: [createScenario({ name: "Patchwerk", end: 120 })],
			gearSets: [gear],
		};
	}

	it("starts empty when nothing is stored", () => {
		const loaded = loadWorkspace(memoryStorage());

		expect(loaded.errors).toEqual([]);
		expect(loaded.workspace.rotations).toEqual([]);
	});

	it("round-trips through storage and through exported text", () => {
		const storage = memoryStorage();
		const workspace = sampleWorkspace();
		saveWorkspace(workspace, storage);

		expect(loadWorkspace(storage)).toEqual({ workspace, errors: [] });
		expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({ workspace, errors: [] });
	});

	it("keeps valid documents and reports invalid ones on import", () => {
		const workspace = sampleWorkspace();
		const text = JSON.stringify({
			...workspace,
			rotations: [
				...workspace.rotations,
				{ ...workspace.rotations[0], id: "", name: "Broken" },
			],
		});
		const parsed = parseWorkspace(text);

		expect(parsed.workspace.rotations).toEqual(workspace.rotations);
		expect(parsed.workspace.scenarios).toEqual(workspace.scenarios);
		expect(parsed.errors).toHaveLength(1);
		expect(parsed.errors[0]).toContain('rotation "Broken" skipped');
	});

	it("backs up unreadable storage instead of losing it", () => {
		const storage = memoryStorage();
		storage.setItem(WORKSPACE_KEY, "{not json");
		const loaded = loadWorkspace(storage);

		expect(loaded.errors[0]).toContain("not valid JSON");
		expect(loaded.workspace.rotations).toEqual([]);
		expect(storage.data.get(CORRUPT_BACKUP_KEY)).toBe("{not json");
	});

	it("rejects workspaces from an unsupported schema version", () => {
		const parsed = parseWorkspace(JSON.stringify({ ...sampleWorkspace(), schemaVersion: 99 }));

		expect(parsed.errors[0]).toContain("unsupported workspace schemaVersion");
	});

	it("migrates version 1 workspaces: scenario stats become a gear set used by every rotation", () => {
		const rotation = { ...createRotation({ name: "Old", job: "VPR", steps: FILLER }) };
		delete rotation.gearSetId;
		const v1Scenario = {
			...createScenario({ name: "Raid", end: 60, stats: { level: 100, countdown: 3 } }),
			stats: { level: 100, countdown: 3, main: 6000, skillSpeed: 600 },
			weaponDelay: 2.7,
		};
		const v1 = {
			schemaVersion: 1,
			rotations: [{ ...rotation, schemaVersion: 1 }],
			scenarios: [{ ...v1Scenario, schemaVersion: 1 }],
		};

		const storage = memoryStorage();
		storage.setItem(WORKSPACE_KEY, JSON.stringify(v1));
		const { workspace, errors, migratedFrom } = loadWorkspace(storage);

		expect(errors).toEqual([]);
		expect(migratedFrom).toBe(1);
		// The old text is kept, since the next save replaces it with the new format.
		expect(storage.data.get(`${WORKSPACE_KEY}.v1`)).toBe(JSON.stringify(v1));
		expect(workspace.schemaVersion).toBe(SCHEMA_VERSION);
		const [gear] = workspace.gearSets;
		expect(gear.name).toBe("Raid gear");
		expect(gear.stats).toEqual({ main: 6000, skillSpeed: 600 });
		expect(gear.weaponDelay).toBe(2.7);
		expect(workspace.scenarios[0].stats).toEqual({ level: 100, countdown: 3 });
		expect("weaponDelay" in workspace.scenarios[0]).toBe(false);
		expect(workspace.rotations[0].gearSetId).toBe(gear.id);

		// The migrated rotation simulates exactly as the old scenario-wide stats did.
		const migrated = simulateDocument(
			workspace.rotations[0],
			workspace.scenarios[0],
			resolveGear(workspace.rotations[0], workspace.gearSets),
		).result;
		const before = simulateRotation(
			{ id: rotation.id, steps: FILLER },
			{
				config: { fps: 0, level: 100, countdown: 3, main: 6000, skillSpeed: 600 },
				weaponDelay: 2.7,
				end: 60,
				encounterRules: true,
				partyBuffs: [],
				downtime: [],
			},
		);
		expect(migrated).toEqual(before);
	});

	it("migrates version 2 workspaces: every rotation is planned for one target", () => {
		const current = sampleWorkspace();
		const asV2 = <T extends object>(doc: T) => ({ ...doc, schemaVersion: 2 });
		const rotation: Partial<RotationDocument> = asV2(current.rotations[0]);
		delete rotation.targetCount;
		const v2 = {
			...current,
			schemaVersion: 2,
			rotations: [rotation],
			scenarios: current.scenarios.map(asV2),
			gearSets: current.gearSets.map(asV2),
		};

		const storage = memoryStorage();
		storage.setItem(WORKSPACE_KEY, JSON.stringify(v2));
		const { workspace, errors, migratedFrom } = loadWorkspace(storage);

		expect(errors).toEqual([]);
		expect(migratedFrom).toBe(2);
		expect(storage.data.get(`${WORKSPACE_KEY}.v2`)).toBe(JSON.stringify(v2));
		expect(workspace).toEqual(current);
	});
});

describe("Rotation Lab - gear sets", () => {
	it("applies the gear set, then the rotation's overrides", () => {
		const gear = createGearSet({
			job: "VPR",
			stats: { main: 6000, skillSpeed: 600 },
			weaponDelay: 2.7,
		});
		const rotation = {
			...createRotation({ name: "R", job: "VPR", steps: FILLER, gearSetId: gear.id }),
			gearOverrides: { stats: { skillSpeed: 800 } },
		};
		expect(resolveGear(rotation, [gear])).toEqual({
			stats: { main: 6000, skillSpeed: 800 },
			weaponDelay: 2.7,
		});
		// A deleted set falls back to the job defaults, keeping the overrides.
		expect(resolveGear(rotation, [])).toEqual({ stats: { skillSpeed: 800 } });
	});

	it("validates gear sets and overrides", () => {
		const gear = createGearSet({ job: "VPR" });
		expect(parseGearSetDocument(gear).ok).toBe(true);
		expect(errorsOf(parseGearSetDocument({ ...gear, stats: { level: 100 } }))).toContain(
			"not a supported stat",
		);
		expect(errorsOf(parseGearSetDocument({ ...gear, weaponDelay: 0 }))).toContain(
			"weaponDelay",
		);
		const rotation = createRotation({ name: "R", job: "VPR", steps: FILLER });
		expect(
			errorsOf(
				parseRotationDocument({ ...rotation, gearOverrides: { stats: { main: -1 } } }),
			),
		).toContain("gearOverrides.stats.main");
	});

	it("gives different results for different skill speeds under one scenario", () => {
		const scenario = createScenario({ end: 60 });
		const rotation = createRotation({ name: "R", job: "VPR", steps: [...FILLER, ...FILLER] });
		const slow = simulateDocument(rotation, scenario, { stats: {} }).result;
		const fast = simulateDocument(rotation, scenario, { stats: { skillSpeed: 1500 } }).result;
		expect(fast.actions[3].startTime).toBeLessThan(slow.actions[3].startTime);
	});
});
