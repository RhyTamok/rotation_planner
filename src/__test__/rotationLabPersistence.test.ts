import { describe, expect, it } from "vitest";

import { BuffType } from "../Game/Common";
import { ActionKey } from "../Game/Data";
import {
	ComparisonDocument,
	createComparison,
	editComparison,
	removeRotationFromComparisons,
} from "../RotationLab/models/Comparison";
import {
	AVAILABLE_RULESETS,
	createRotation,
	resultLabel,
	RotationDocument,
	SCHEMA_VERSION,
} from "../RotationLab/models/Rotation";
import {
	createScenario,
	ScenarioDocument,
	scenarioToOptions,
} from "../RotationLab/models/Scenario";
import {
	parseComparisonDocument,
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
	mergeWorkspace,
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
			["targets must be an array", (d) => ({ ...d, targets: undefined })],
			["enemies from 2", (d) => ({ ...d, targets: [{ start: 0, end: 10, enemies: 1 }] })],
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
			timeZero: "firstPress",
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
			timeZero: "firstPress",
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
			comparisons: [] as ComparisonDocument[],
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
		// Version 2 had neither the target count (3) nor target ranges (4).
		const rotation: Partial<RotationDocument> = asV2(current.rotations[0]);
		delete rotation.targets;
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

	it("migrates version 3 workspaces: the target count is dropped for empty target ranges", () => {
		const current = sampleWorkspace();
		const asV3 = <T extends object>(doc: T) => ({ ...doc, schemaVersion: 3 });
		const rotation: Record<string, unknown> = { ...asV3(current.rotations[0]), targetCount: 1 };
		delete rotation.targets;
		const v3 = {
			...current,
			schemaVersion: 3,
			rotations: [rotation],
			scenarios: current.scenarios.map(asV3),
			gearSets: current.gearSets.map(asV3),
		};

		const storage = memoryStorage();
		storage.setItem(WORKSPACE_KEY, JSON.stringify(v3));
		const { workspace, errors, migratedFrom } = loadWorkspace(storage);

		expect(errors).toEqual([]);
		expect(migratedFrom).toBe(3);
		expect(workspace).toEqual(current);
		expect("targetCount" in workspace.rotations[0]).toBe(false);
		expect(workspace.rotations[0].targets).toEqual([]);
	});

	it("migrates version 4 workspaces: documents are kept and there are no comparisons yet", () => {
		const current = sampleWorkspace();
		const asV4 = <T extends object>(doc: T) => ({ ...doc, schemaVersion: 4 });
		const v4 = {
			schemaVersion: 4,
			rotations: current.rotations.map(asV4),
			scenarios: current.scenarios.map(asV4),
			gearSets: current.gearSets.map(asV4),
		};

		const storage = memoryStorage();
		storage.setItem(WORKSPACE_KEY, JSON.stringify(v4));
		const { workspace, errors, migratedFrom } = loadWorkspace(storage);

		expect(errors).toEqual([]);
		expect(migratedFrom).toBe(4);
		expect(storage.data.get(`${WORKSPACE_KEY}.v4`)).toBe(JSON.stringify(v4));
		expect(workspace).toEqual(current);
		expect(workspace.comparisons).toEqual([]);
	});
});

describe("Rotation Lab - comparison documents", () => {
	function sampleWorkspace() {
		const a = createRotation({ name: "A", job: "VPR", steps: FILLER });
		const b = createRotation({ name: "B", job: "VPR", steps: FILLER });
		const c = createRotation({ name: "C", job: "VPR", steps: FILLER });
		const scenario = createScenario({ name: "Patchwerk" });
		const comparison = createComparison({
			name: "Kill times",
			job: "VPR",
			scenarioId: scenario.id,
			rotationIds: [a.id, b.id, c.id],
		});
		return {
			schemaVersion: SCHEMA_VERSION,
			rotations: [a, b, c],
			scenarios: [scenario],
			gearSets: [],
			comparisons: [comparison],
		};
	}

	it("creates a valid document with the first configuration as the baseline", () => {
		const workspace = sampleWorkspace();
		const [doc] = workspace.comparisons;

		expect(parseComparisonDocument(doc, workspace).ok).toBe(true);
		expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
		expect(doc.revision).toBe(1);
		expect(doc.baselineId).toBe(doc.configurations[0].id);
		expect(new Set(doc.configurations.map((c) => c.id)).size).toBe(3);
	});

	it("round-trips every field through parseWorkspace and through storage", () => {
		const workspace = sampleWorkspace();
		const doc = workspace.comparisons[0];
		workspace.comparisons[0] = {
			...doc,
			baselineId: doc.configurations[1].id,
			cutoffs: [120, 360.5],
			burstWindows: [{ start: 0, end: 20, label: "Opener" }],
			analysis: {
				epsilonPct: 0.25,
				graphUnit: "pct",
				intervalStart: 30,
				intervalEnd: 300,
				sensitivityTime: 240,
				sensitivityDelta: 15,
			},
			display: { chartsFrom: 30 },
		};

		expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({ workspace, errors: [] });
		const storage = memoryStorage();
		saveWorkspace(workspace, storage);
		expect(loadWorkspace(storage)).toEqual({ workspace, errors: [] });
	});

	it("migrates version 5 workspaces: stored comparisons keep everything and gain settings", () => {
		const workspace = sampleWorkspace();
		const [stored] = workspace.comparisons;
		const v5 = (doc: object) => ({ ...doc, schemaVersion: 5 });
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { analysis: _new, ...withoutAnalysis } = {
			...stored,
			baselineId: stored.configurations[1].id,
			cutoffs: [60, 120],
			display: { chartsFrom: 30 },
		};
		const text = JSON.stringify({
			schemaVersion: 5,
			rotations: workspace.rotations.map(v5),
			scenarios: workspace.scenarios.map(v5),
			gearSets: [],
			comparisons: [v5(withoutAnalysis)],
		});

		const { workspace: migrated, errors } = parseWorkspace(text);
		expect(errors).toEqual([]);
		expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
		expect(migrated.comparisons).toEqual([
			{
				...withoutAnalysis,
				schemaVersion: SCHEMA_VERSION,
				analysis: { epsilonPct: 0.1, graphUnit: "dps", sensitivityDelta: 10 },
			},
		]);
		expect(migrated.rotations.map((r) => r.schemaVersion)).toEqual([
			SCHEMA_VERSION,
			SCHEMA_VERSION,
			SCHEMA_VERSION,
		]);
	});

	it("migrates version 6 workspaces: scenarios keep the first hit at 0 s", () => {
		const workspace = sampleWorkspace();
		const v6 = (doc: object) => ({ ...doc, schemaVersion: 6 });
		const text = JSON.stringify({
			schemaVersion: 6,
			rotations: workspace.rotations.map(v6),
			scenarios: workspace.scenarios.map(({ timeZero: _new, ...scenario }) => v6(scenario)),
			gearSets: workspace.gearSets.map(v6),
			comparisons: workspace.comparisons.map(v6),
		});

		const { workspace: migrated, errors } = parseWorkspace(text);
		expect(errors).toEqual([]);
		expect(migrated).toEqual(workspace);
		expect(migrated.scenarios.map((s) => s.timeZero)).toEqual(
			workspace.scenarios.map(() => "firstHit"),
		);
	});

	it("writes what produced it into an exported workspace; importing ignores it", () => {
		const workspace = sampleWorkspace();
		const text = serializeWorkspace(workspace);
		expect(JSON.parse(text).exportedWith).toEqual(resultLabel());
		expect(parseWorkspace(text)).toEqual({ workspace, errors: [] });
		// The stored workspace itself carries no label: it is always re-simulated on load.
		const storage = memoryStorage();
		saveWorkspace(workspace, storage);
		expect(JSON.parse(storage.data.get(WORKSPACE_KEY)!).exportedWith).toBeUndefined();
	});

	it("rejects a scenario without a valid time zero", () => {
		const scenario = createScenario({ timeZero: "firstPress" });
		expect(parseScenarioDocument(scenario).ok).toBe(true);
		expect(parseScenarioDocument({ ...scenario, timeZero: "pull" }).ok).toBe(false);
		expect(parseScenarioDocument({ ...scenario, timeZero: undefined }).ok).toBe(false);
	});

	it("rejects analysis settings out of range, but not ones that only clash with each other", () => {
		const workspace = sampleWorkspace();
		const [doc] = workspace.comparisons;
		const parsed = (analysis: object) =>
			parseComparisonDocument(
				{ ...doc, analysis: { ...doc.analysis, ...analysis } },
				workspace,
			);
		const errors = (analysis: object) => {
			const result = parsed(analysis);
			return result.ok ? "" : result.errors.join();
		};
		expect(errors({ epsilonPct: 0.001 })).toContain("analysis.epsilonPct");
		expect(errors({ epsilonPct: 1.01 })).toContain("analysis.epsilonPct");
		expect(errors({ graphUnit: "hps" })).toContain("analysis.graphUnit");
		expect(errors({ intervalStart: 0 })).toContain("analysis.intervalStart");
		expect(errors({ sensitivityTime: -1 })).toContain("analysis.sensitivityTime");
		expect(errors({ sensitivityDelta: 0 })).toContain("analysis.sensitivityDelta");
		expect(parsed({ epsilonPct: 0.01 }).ok).toBe(true);
		expect(parsed({ epsilonPct: 1 }).ok).toBe(true);
		// An empty interval depends on the fight, so it must not stop the workspace from saving.
		expect(parsed({ intervalStart: 90, intervalEnd: 10 }).ok).toBe(true);
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { analysis: _gone, ...missing } = doc;
		expect(parseComparisonDocument(missing, workspace).ok).toBe(false);
	});

	it("rejects invalid documents with readable errors", () => {
		const workspace = sampleWorkspace();
		const dragoon = createRotation({ name: "Drg", job: "DRG", steps: [] });
		const references = { ...workspace, rotations: [...workspace.rotations, dragoon] };
		const valid = workspace.comparisons[0];
		const [a, b, c] = valid.configurations;
		const cases: [string, (doc: ComparisonDocument) => unknown][] = [
			["schemaVersion", (d) => ({ ...d, schemaVersion: 4 })],
			["revision", (d) => ({ ...d, revision: 0 })],
			["unknown job", (d) => ({ ...d, job: "XYZ" })],
			["scenarioId", (d) => ({ ...d, scenarioId: "gone" })],
			// Was "2 to 4, found 1" until one-configuration comparisons were allowed (roadmap C3).
			["1 to 4 entries, found 0", (d) => ({ ...d, configurations: [] })],
			[
				"1 to 4 entries, found 5",
				(d) => ({
					...d,
					configurations: [
						a,
						b,
						c,
						{ id: "d", rotationId: a.rotationId },
						{ id: "e", rotationId: a.rotationId },
					],
				}),
			],
			["duplicate id", (d) => ({ ...d, configurations: [a, a] })],
			[
				"is not in the workspace",
				(d) => ({ ...d, configurations: [a, { id: "x", rotationId: "gone" }] }),
			],
			[
				'rotation "Drg" is DRG, not "VPR"',
				(d) => ({ ...d, configurations: [a, { id: "x", rotationId: dragoon.id }] }),
			],
			["baselineId", (d) => ({ ...d, baselineId: "gone" })],
			["cutoffs", (d) => ({ ...d, cutoffs: [0] })],
			["cutoffs", (d) => ({ ...d, cutoffs: "60" })],
			["burstWindows[0]", (d) => ({ ...d, burstWindows: [{ start: 5, end: 5 }] })],
			["display must be", (d) => ({ ...d, display: undefined })],
			["display.chartsFrom", (d) => ({ ...d, display: { chartsFrom: -1 } })],
		];
		for (const [expectedError, mutate] of cases) {
			const parsed = parseComparisonDocument(mutate(valid), references);
			expect(parsed.ok, expectedError).toBe(false);
			expect(errorsOf(parsed)).toContain(expectedError);
		}
	});

	it("allows the same rotation twice, as long as the configurations have their own ids", () => {
		const workspace = sampleWorkspace();
		const rotationId = workspace.rotations[0].id;
		const doc = createComparison({
			job: "VPR",
			scenarioId: workspace.scenarios[0].id,
			rotationIds: [rotationId, rotationId],
		});
		expect(parseComparisonDocument(doc, workspace).ok).toBe(true);
	});

	it("skips a comparison whose rotation was itself skipped, and reports both", () => {
		const workspace = sampleWorkspace();
		const text = JSON.stringify({
			...workspace,
			rotations: [{ ...workspace.rotations[0], job: "XYZ" }, ...workspace.rotations.slice(1)],
		});
		const parsed = parseWorkspace(text);

		expect(parsed.workspace.comparisons).toEqual([]);
		expect(parsed.errors).toHaveLength(2);
		expect(parsed.errors[1]).toContain('comparison "Kill times" skipped');
	});

	it("bumps the revision on every edit and leaves the original untouched", () => {
		const [doc] = sampleWorkspace().comparisons;
		const edited = editComparison(doc, { cutoffs: [60] });

		expect(edited.revision).toBe(2);
		expect(edited.cutoffs).toEqual([60]);
		expect(doc.cutoffs).toEqual([]);
		expect(doc.revision).toBe(1);
	});

	it("removes a deleted rotation, moving the baseline if needed", () => {
		const workspace = sampleWorkspace();
		const [doc] = workspace.comparisons;
		const [, b, c] = workspace.rotations;
		const [configA] = doc.configurations;

		// The baseline's rotation goes: the baseline moves to the first one left.
		const [withoutA] = removeRotationFromComparisons([doc], configA.rotationId);
		expect(withoutA.configurations.map((x) => x.rotationId)).toEqual([b.id, c.id]);
		expect(withoutA.baselineId).toBe(withoutA.configurations[0].id);
		expect(withoutA.revision).toBe(2);
		expect(
			parseComparisonDocument(withoutA, {
				...workspace,
				rotations: workspace.rotations.slice(1),
			}).ok,
		).toBe(true);

		// Another rotation goes: the baseline stays.
		const [withoutB] = removeRotationFromComparisons([doc], b.id);
		expect(withoutB.baselineId).toBe(doc.baselineId);

		// Changed on purpose (roadmap C3): one configuration left is a valid comparison. Only
		// losing the last one drops it, where falling below two used to.
		const [onlyC] = removeRotationFromComparisons([withoutA], b.id);
		expect(onlyC.configurations.map((x) => x.rotationId)).toEqual([c.id]);
		expect(onlyC.baselineId).toBe(onlyC.configurations[0].id);
		expect(removeRotationFromComparisons([onlyC], c.id)).toEqual([]);

		// Not involved: the very same document comes back.
		const unrelated = removeRotationFromComparisons([doc], "other")[0];
		expect(unrelated).toBe(doc);
	});

	it("re-points imported comparisons at the fresh ids of clashing documents", () => {
		const current = sampleWorkspace();
		const merged = mergeWorkspace(current, sampleWorkspaceCopy(current));

		expect(merged.rotations).toHaveLength(6);
		expect(merged.comparisons).toHaveLength(2);
		const [original, imported] = merged.comparisons;
		expect(original).toEqual(current.comparisons[0]);
		expect(imported.id).not.toBe(original.id);
		expect(imported.scenarioId).toBe(merged.scenarios[1].id);
		expect(imported.scenarioId).not.toBe(original.scenarioId);
		expect(imported.configurations.map((c) => c.rotationId)).toEqual(
			merged.rotations.slice(3).map((r) => r.id),
		);
		// The configuration ids are local to the document, so the baseline stays valid.
		for (const doc of merged.comparisons) {
			expect(parseComparisonDocument(doc, merged).ok).toBe(true);
		}
	});

	it("keeps an imported comparison's ids when nothing clashes", () => {
		const imported = sampleWorkspace();
		const merged = mergeWorkspace(
			{ ...sampleWorkspace(), rotations: [], scenarios: [], comparisons: [] },
			imported,
		);
		expect(merged.comparisons).toEqual(imported.comparisons);
	});

	function sampleWorkspaceCopy<T>(workspace: T): T {
		return JSON.parse(JSON.stringify(workspace)) as T;
	}
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
