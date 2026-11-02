import { ShellJob } from "../../Game/Data/Jobs";
import { ConfigData } from "../../Game/GameConfig";
import { newId, RotationDocument, SCHEMA_VERSION } from "./Rotation";

// A named set of character stats that rotations pick, so rotations at different GCD speeds can be
// compared under the same fight scenario. Fields left out keep the job's defaults.
export const GEAR_STAT_KEYS = [
	"main",
	"wd",
	"criticalHit",
	"directHit",
	"determination",
	"skillSpeed",
	"tenacity",
] as const satisfies readonly (keyof ConfigData)[];

export type GearStatKey = (typeof GEAR_STAT_KEYS)[number];
export type GearStats = Partial<Pick<ConfigData, GearStatKey>>;

export interface GearSetDocument {
	schemaVersion: number;
	id: string;
	name: string;
	job: ShellJob;
	stats: GearStats;
	// Seconds; undefined keeps the job's default weapon delay.
	weaponDelay?: number;
	updatedAt: string;
}

// A rotation's manual overrides on top of its gear set.
export interface GearOverrides {
	stats: GearStats;
	weaponDelay?: number;
}

// The stats a rotation is simulated with: its gear set, then its overrides.
export interface ResolvedGear {
	stats: GearStats;
	weaponDelay?: number;
}

export const NO_GEAR: ResolvedGear = { stats: {} };

export function createGearSet(
	props: Partial<Omit<GearSetDocument, "schemaVersion" | "id" | "updatedAt">> & { job: ShellJob },
): GearSetDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId(),
		name: props.name ?? "New gear set",
		job: props.job,
		stats: props.stats ?? {},
		weaponDelay: props.weaponDelay,
		updatedAt: new Date().toISOString(),
	};
}

// A missing or deleted gear set falls back to the job's defaults (plus any overrides).
export function resolveGear(rotation: RotationDocument, gearSets: GearSetDocument[]): ResolvedGear {
	const set = gearSets.find((g) => g.id === rotation.gearSetId);
	const overrides = rotation.gearOverrides;
	return {
		stats: { ...set?.stats, ...overrides?.stats },
		weaponDelay: overrides?.weaponDelay ?? set?.weaponDelay,
	};
}
