import { ConfigData } from "../../Game/GameConfig";
import { GemdraughtGrade } from "../damage/DamageModel";
import {
	DowntimeWindow,
	PartyBuffWindow,
	SimulationEnd,
	SimulationOptions,
} from "../simulation/types";
import { newId, SCHEMA_VERSION } from "./Rotation";

// The config fields a scenario may set. Everything else keeps the job's defaults, so saved
// scenarios stay small and only describe conditions that matter for comparison.
export const SCENARIO_STAT_KEYS = [
	"level",
	"main",
	"wd",
	"partyBonus",
	"criticalHit",
	"directHit",
	"determination",
	"skillSpeed",
	"tenacity",
	"countdown",
] as const satisfies readonly (keyof ConfigData)[];

export type ScenarioStats = Partial<Pick<ConfigData, (typeof SCENARIO_STAT_KEYS)[number]>>;

// Shared simulation conditions. Rotations compared against each other should use the same
// scenario, so that differences come only from the rotations themselves.
export interface ScenarioDocument {
	schemaVersion: number;
	id: string;
	name: string;
	stats: ScenarioStats;
	weaponDelay?: number;
	tinctureGrade?: GemdraughtGrade;
	partyBuffs: PartyBuffWindow[];
	downtime: DowntimeWindow[];
	end: SimulationEnd;
	updatedAt: string;
}

export function createScenario(
	props: Partial<Omit<ScenarioDocument, "schemaVersion" | "id" | "updatedAt">> = {},
): ScenarioDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId(),
		name: props.name ?? "Default scenario",
		stats: props.stats ?? {},
		weaponDelay: props.weaponDelay,
		tinctureGrade: props.tinctureGrade,
		partyBuffs: props.partyBuffs ?? [],
		downtime: props.downtime ?? [],
		end: props.end ?? "settled",
		updatedAt: new Date().toISOString(),
	};
}

export function scenarioToOptions(scenario: ScenarioDocument): SimulationOptions {
	return {
		config: { ...scenario.stats },
		weaponDelay: scenario.weaponDelay,
		tinctureGrade: scenario.tinctureGrade,
		partyBuffs: scenario.partyBuffs.map((w) => ({ ...w })),
		downtime: scenario.downtime.map((w) => ({ ...w })),
		end: scenario.end,
	};
}
