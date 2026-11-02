import { LevelSync } from "../../Game/Common";
import { ShellJob } from "../../Game/Data/Jobs";

// Deterministic expected-damage formulas for physical (non-caster) jobs.
// Reimplemented from xivgear's xivmath, with the same rounding order:
// https://github.com/xiv-gear-planner/gear-planner/blob/main/packages/xivmath/src/xivmath.ts
// (baseDamageFull, mainStatMulti, wdMulti, autoAttackModifier, detDmg, critChance, critDmg,
// dhitChance, tenacityDmg, sksTickMulti) and packages/sims/src/common/potion.ts (gemdraughts).

interface LevelConstants {
	baseMainStat: number;
	baseSubStat: number;
	levelDiv: number;
	// Attack power slope for non-tank jobs (xivgear: mainStatPowerMod.other).
	mainStatPowerMod: number;
}

// Only levels with values verified against xivgear's xivconstants.ts.
const LEVEL_CONSTANTS: Partial<Record<LevelSync, LevelConstants>> = {
	[LevelSync.lvl80]: {
		baseMainStat: 340,
		baseSubStat: 380,
		levelDiv: 1300,
		mainStatPowerMod: 165,
	},
	[LevelSync.lvl90]: {
		baseMainStat: 390,
		baseSubStat: 400,
		levelDiv: 1900,
		mainStatPowerMod: 195,
	},
	[LevelSync.lvl100]: {
		baseMainStat: 440,
		baseSubStat: 420,
		levelDiv: 2780,
		mainStatPowerMod: 237,
	},
};

interface JobConstants {
	// ClassJob modifier for the job's main stat (also its auto-attack stat for these jobs).
	mainStatJobMod: number;
	// Damage trait multiplier for non-auto-attack hits.
	traitMulti: number;
	// Weapon delay in seconds; constant across the job's weapons so far.
	defaultWeaponDelay: number;
}

const JOB_CONSTANTS: Partial<Record<ShellJob, JobConstants>> = {
	// Dexterity modifier 110 confirmed by the user; no damage trait (xivgear MELEE_SCOUTING).
	VPR: { mainStatJobMod: 110, traitMulti: 1, defaultWeaponDelay: 2.64 },
};

export function getDefaultWeaponDelay(job: ShellJob): number | undefined {
	return JOB_CONSTANTS[job]?.defaultWeaponDelay;
}

// Grade 1-4 Gemdraught: +10% main stat, capped (xivgear potion.ts gradeToStatCap).
const GEMDRAUGHT_CAPS = [351, 392, 461, 541] as const;
export type GemdraughtGrade = 1 | 2 | 3 | 4;

export interface CharacterStats {
	level: LevelSync;
	// Raw main stat with gear and race, before the party bonus.
	main: number;
	wd: number;
	// Weapon delay in seconds.
	weaponDelay: number;
	// Party bonus in percent (1 per distinct role, max 5).
	partyBonus: number;
	criticalHit: number;
	directHit: number;
	determination: number;
	skillSpeed: number;
	tenacity: number;
}

export type HitKind = "direct" | "dot" | "auto";

// Floor with tolerance for floating-point error, e.g. 2.3 * 100 => 229.99999999999997 floors to 230.
export function fl(x: number): number {
	const floored = Math.floor(x);
	return x - floored >= 0.99999995 ? floored + 1 : floored;
}

function trunc(x: number): number {
	return x > 0 ? fl(x) : x < 0 ? -fl(-x) : 0;
}

export function isDamageModelSupported(job: ShellJob, level: LevelSync): boolean {
	return JOB_CONSTANTS[job] !== undefined && LEVEL_CONSTANTS[level] !== undefined;
}

export class DamageModel {
	readonly #level: LevelConstants;
	readonly #job: JobConstants;
	readonly stats: CharacterStats;
	// Main stat after the party bonus.
	readonly mainStat: number;

	constructor(job: ShellJob, stats: CharacterStats) {
		const level = LEVEL_CONSTANTS[stats.level];
		const jobConstants = JOB_CONSTANTS[job];
		if (!level || !jobConstants) {
			throw new Error(`No verified damage constants for ${job} at level ${stats.level}`);
		}
		this.#level = level;
		this.#job = jobConstants;
		this.stats = stats;
		this.mainStat = fl(stats.main * (1 + 0.01 * stats.partyBonus));
	}

	tinctureBonus(grade: GemdraughtGrade): number {
		return Math.min(fl(this.mainStat * 0.1), GEMDRAUGHT_CAPS[grade - 1]);
	}

	mainStatMulti(mainStat: number): number {
		const { baseMainStat, mainStatPowerMod } = this.#level;
		return Math.max(
			0,
			(trunc((mainStatPowerMod * (mainStat - baseMainStat)) / baseMainStat) + 100) / 100,
		);
	}

	wdMulti(): number {
		return (
			fl((this.#level.baseMainStat * this.#job.mainStatJobMod) / 1000 + this.stats.wd) / 100
		);
	}

	autoAttackMulti(): number {
		const wdPart = fl(
			(this.#level.baseMainStat * this.#job.mainStatJobMod) / 1000 + this.stats.wd,
		);
		return fl(wdPart * (this.stats.weaponDelay / 3)) / 100;
	}

	detMulti(): number {
		const { baseMainStat, levelDiv } = this.#level;
		return (1000 + fl((140 * (this.stats.determination - baseMainStat)) / levelDiv)) / 1000;
	}

	tenacityMulti(): number {
		const { baseSubStat, levelDiv } = this.#level;
		return (1000 + fl((112 * (this.stats.tenacity - baseSubStat)) / levelDiv)) / 1000;
	}

	skillSpeedMulti(): number {
		const { baseSubStat, levelDiv } = this.#level;
		return (1000 + fl((130 * (this.stats.skillSpeed - baseSubStat)) / levelDiv)) / 1000;
	}

	critChance(): number {
		const { baseSubStat, levelDiv } = this.#level;
		return fl((200 * (this.stats.criticalHit - baseSubStat)) / levelDiv + 50) / 1000;
	}

	critMulti(): number {
		const { baseSubStat, levelDiv } = this.#level;
		return (1400 + fl((200 * (this.stats.criticalHit - baseSubStat)) / levelDiv)) / 1000;
	}

	directHitChance(): number {
		const { baseSubStat, levelDiv } = this.#level;
		return fl((550 * (this.stats.directHit - baseSubStat)) / levelDiv) / 1000;
	}

	// Expected multiplier from the character's own crit and direct hit rates (DH multiplier 1.25).
	expectedCritDhMulti(): number {
		return (
			(1 + this.directHitChance() * 0.25) * (1 + this.critChance() * (this.critMulti() - 1))
		);
	}

	// Damage before crit/DH and variance: xivgear's baseDamageFull for non-caster jobs.
	// `potency` is the unscaled potency; speed scaling for DoTs and autos is applied here.
	baseDamage(potency: number, kind: HitKind, tinctureBonus = 0): number {
		const mainStatMulti = this.mainStatMulti(this.mainStat + tinctureBonus);
		const wdMulti = kind === "auto" ? this.autoAttackMulti() : this.wdMulti();
		const speedMulti = kind === "direct" ? 1 : this.skillSpeedMulti();
		const traitMulti = kind === "auto" ? 1 : this.#job.traitMulti;

		const afterMainStat = fl(potency * mainStatMulti);
		const afterDet = fl(afterMainStat * this.detMulti());
		const afterTenacity = fl(afterDet * this.tenacityMulti());
		const afterWeaponDamage = fl(afterTenacity * wdMulti);
		const afterSpeed = fl(afterWeaponDamage * speedMulti);
		const finalDamage = fl(afterSpeed * traitMulti) + (potency < 100 ? 1 : 0);
		return Math.max(finalDamage, 1);
	}
}
