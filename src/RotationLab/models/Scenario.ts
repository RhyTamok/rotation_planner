import { ConfigData } from "../../Game/GameConfig";
import { GemdraughtGrade } from "../damage/DamageModel";
import {
	DowntimeWindow,
	PartyBuffWindow,
	SimulationEnd,
	SimulationOptions,
} from "../simulation/types";
import { NO_GEAR, ResolvedGear } from "./GearSet";
import { newId, SCHEMA_VERSION } from "./Rotation";

// The config fields a scenario may set: the fight conditions shared by every rotation compared
// under it. Character stats live in gear sets, chosen per rotation (GearSet.ts). Everything else
// keeps the job's defaults.
export const SCENARIO_STAT_KEYS = [
	"level",
	"partyBonus",
	"countdown",
	"fps",
] as const satisfies readonly (keyof ConfigData)[];

export type ScenarioStats = Partial<Pick<ConfigData, (typeof SCENARIO_STAT_KEYS)[number]>>;

// Where a scenario's default differs from the job's XIV in the Shell default. The Lab uses nominal
// GCD lengths (e.g. 2.12 s under Swiftscaled), so the frame-rate tax is off unless an FPS is set.
export const SCENARIO_STAT_DEFAULTS: ScenarioStats = { fps: 0 };

// Shared simulation conditions. Rotations compared against each other should use the same
// scenario, so that differences come only from the rotations (and their gear) themselves.
export interface ScenarioDocument {
	schemaVersion: number;
	id: string;
	name: string;
	stats: ScenarioStats;
	tinctureGrade?: GemdraughtGrade;
	partyBuffs: PartyBuffWindow[];
	downtime: DowntimeWindow[];
	end: SimulationEnd;
	// Windows the comparison reports damage for (e.g. two-minute bursts). Not a simulation input.
	// When absent, the comparison derives them from the party buffs.
	burstWindows?: BurstWindow[];
	updatedAt: string;
}

export interface BurstWindow {
	start: number;
	end: number;
	label?: string;
}

export function createScenario(
	props: Partial<Omit<ScenarioDocument, "schemaVersion" | "id" | "updatedAt">> = {},
): ScenarioDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId(),
		name: props.name ?? "Default scenario",
		stats: props.stats ?? {},
		tinctureGrade: props.tinctureGrade,
		partyBuffs: props.partyBuffs ?? [],
		downtime: props.downtime ?? [],
		end: props.end ?? "settled",
		updatedAt: new Date().toISOString(),
	};
}

// Simulation options for one rotation: the scenario's fight conditions plus that rotation's gear.
export function scenarioToOptions(
	scenario: ScenarioDocument,
	gear: ResolvedGear = NO_GEAR,
): SimulationOptions {
	return {
		config: { ...SCENARIO_STAT_DEFAULTS, ...scenario.stats, ...gear.stats },
		weaponDelay: gear.weaponDelay,
		tinctureGrade: scenario.tinctureGrade,
		partyBuffs: scenario.partyBuffs.map((w) => ({ ...w })),
		downtime: scenario.downtime.map((w) => ({ ...w })),
		end: scenario.end,
		encounterRules: true,
	};
}
