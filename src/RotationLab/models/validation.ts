import { MAX_ABILITY_TARGETS } from "../../Controller/Common";
import { getBuffColor } from "../../Game/Buffs";
import { BuffType } from "../../Game/Common";
import { ActionKey } from "../../Game/Data";
import { ALL_JOBS, ShellJob } from "../../Game/Data/Jobs";
import { jobHasSkill } from "../../Game/Skills";
import { RotationStep, SimulationEnd } from "../simulation/types";
import { GEAR_STAT_KEYS, GearSetDocument } from "./GearSet";
import { CombatMode, RotationDocument, SCHEMA_VERSION } from "./Rotation";
import { SCENARIO_STAT_KEYS, ScenarioDocument, ScenarioStats } from "./Scenario";

// Validation for documents read from storage or imported from files. Anything that reaches the
// simulator has passed through here, so hand-edited or corrupt files fail with readable errors.

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const COMBAT_MODES: readonly CombatMode[] = ["reborn", "evolved"];
const LEVELS: readonly number[] = [70, 80, 90, 100];

type Obj = Record<string, unknown>;

const isObject = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isNonEmptyString = (x: unknown): x is string => typeof x === "string" && x.length > 0;

// Older versions are migrated before validation (storage/migrations.ts).
function checkSchemaVersion(doc: Obj, errors: string[]) {
	if (doc.schemaVersion !== SCHEMA_VERSION) {
		errors.push(
			`unsupported schemaVersion ${JSON.stringify(doc.schemaVersion)} (expected ${SCHEMA_VERSION})`,
		);
	}
}

function checkCommonFields(doc: Obj, errors: string[]) {
	if (!isNonEmptyString(doc.id)) errors.push("id must be a non-empty string");
	if (typeof doc.name !== "string") errors.push("name must be a string");
	if (typeof doc.updatedAt !== "string" || Number.isNaN(Date.parse(doc.updatedAt))) {
		errors.push("updatedAt must be an ISO date string");
	}
}

function validateStep(job: ShellJob, step: unknown, where: string, errors: string[]) {
	if (!isObject(step)) {
		errors.push(`${where}: step must be an object`);
		return;
	}
	const s = step as Partial<RotationStep> & Obj;
	if (s.type === "skill") {
		if (typeof s.action !== "string" || !jobHasSkill(job, s.action as ActionKey)) {
			errors.push(`${where}: ${JSON.stringify(s.action)} is not a ${job} action`);
		}
		if (
			s.targets !== undefined &&
			!(
				Array.isArray(s.targets) &&
				s.targets.every(
					(t) =>
						Number.isInteger(t) &&
						(t as number) >= 1 &&
						(t as number) <= MAX_ABILITY_TARGETS,
				)
			)
		) {
			errors.push(`${where}: targets must be integers from 1 to ${MAX_ABILITY_TARGETS}`);
		}
		if (s.delay !== undefined && !(isFiniteNumber(s.delay) && s.delay >= 0)) {
			errors.push(`${where}: delay must be a non-negative number`);
		}
	} else if (s.type === "wait") {
		if (!isFiniteNumber(s.seconds) || s.seconds < 0) {
			errors.push(`${where}: wait seconds must be a non-negative number`);
		}
	} else if (s.type === "jumpTo") {
		if (!isFiniteNumber(s.displayTime)) {
			errors.push(`${where}: jumpTo displayTime must be a number`);
		}
	} else {
		errors.push(`${where}: unknown step type ${JSON.stringify(s.type)}`);
	}
}

export function parseRotationDocument(input: unknown): ParseResult<RotationDocument> {
	const errors: string[] = [];
	if (!isObject(input)) {
		return { ok: false, errors: ["rotation must be an object"] };
	}
	checkSchemaVersion(input, errors);
	checkCommonFields(input, errors);

	const job = input.job;
	const jobValid = typeof job === "string" && (ALL_JOBS as string[]).includes(job);
	if (!jobValid) errors.push(`unknown job ${JSON.stringify(job)}`);

	const ruleset = input.ruleset;
	if (
		!isObject(ruleset) ||
		!COMBAT_MODES.includes(ruleset.mode as CombatMode) ||
		!isNonEmptyString(ruleset.version)
	) {
		errors.push("ruleset must have a mode (reborn or evolved) and a version");
	}

	if (!Array.isArray(input.entries)) {
		errors.push("entries must be an array");
	} else {
		const seenIds = new Set<string>();
		input.entries.forEach((entry, i) => {
			const where = `entries[${i}]`;
			if (!isObject(entry) || !isNonEmptyString(entry.id)) {
				errors.push(`${where}: entry must have a non-empty id`);
				return;
			}
			if (seenIds.has(entry.id)) errors.push(`${where}: duplicate entry id ${entry.id}`);
			seenIds.add(entry.id);
			// Actions can only be checked against a known job.
			if (jobValid) validateStep(job as ShellJob, entry.step, where, errors);
		});
	}

	if (!(Number.isInteger(input.targetCount) && (input.targetCount as number) >= 1)) {
		errors.push("targetCount must be a whole number of at least 1");
	}
	if (input.gearSetId !== undefined && !isNonEmptyString(input.gearSetId)) {
		errors.push("gearSetId must be a non-empty string");
	}
	if (input.gearOverrides !== undefined) {
		if (!isObject(input.gearOverrides)) {
			errors.push("gearOverrides must be an object");
		} else {
			validateStats(input.gearOverrides.stats, GEAR_STAT_KEYS, errors, "gearOverrides.stats");
			validateWeaponDelay(
				input.gearOverrides.weaponDelay,
				errors,
				"gearOverrides.weaponDelay",
			);
		}
	}

	return errors.length > 0
		? { ok: false, errors }
		: { ok: true, value: input as unknown as RotationDocument };
}

function validateStats(
	stats: unknown,
	allowed: readonly string[],
	errors: string[],
	where = "stats",
) {
	if (!isObject(stats)) {
		errors.push(`${where} must be an object`);
		return;
	}
	for (const [key, value] of Object.entries(stats)) {
		if (!allowed.includes(key)) {
			errors.push(`${where}.${key} is not a supported stat`);
		} else if (!isFiniteNumber(value) || value < 0) {
			errors.push(`${where}.${key} must be a non-negative number`);
		}
	}
	const level = (stats as ScenarioStats).level;
	if (level !== undefined && !LEVELS.includes(level)) {
		errors.push(`${where}.level must be one of ${LEVELS.join(", ")}`);
	}
}

function validateWeaponDelay(value: unknown, errors: string[], where = "weaponDelay") {
	if (value !== undefined && !(isFiniteNumber(value) && value > 0)) {
		errors.push(`${where} must be a positive number`);
	}
}

export function parseGearSetDocument(input: unknown): ParseResult<GearSetDocument> {
	const errors: string[] = [];
	if (!isObject(input)) {
		return { ok: false, errors: ["gear set must be an object"] };
	}
	checkSchemaVersion(input, errors);
	checkCommonFields(input, errors);
	if (typeof input.job !== "string" || !(ALL_JOBS as string[]).includes(input.job)) {
		errors.push(`unknown job ${JSON.stringify(input.job)}`);
	}
	validateStats(input.stats, GEAR_STAT_KEYS, errors);
	validateWeaponDelay(input.weaponDelay, errors);
	return errors.length > 0
		? { ok: false, errors }
		: { ok: true, value: input as unknown as GearSetDocument };
}

function isSimulationEnd(x: unknown): x is SimulationEnd {
	return x === "lastAction" || x === "settled" || isFiniteNumber(x);
}

export function parseScenarioDocument(input: unknown): ParseResult<ScenarioDocument> {
	const errors: string[] = [];
	if (!isObject(input)) {
		return { ok: false, errors: ["scenario must be an object"] };
	}
	checkSchemaVersion(input, errors);
	checkCommonFields(input, errors);
	validateStats(input.stats, SCENARIO_STAT_KEYS, errors);

	if (
		input.tinctureGrade !== undefined &&
		![1, 2, 3, 4].includes(input.tinctureGrade as number)
	) {
		errors.push("tinctureGrade must be 1, 2, 3 or 4");
	}
	if (input.burstWindows !== undefined) {
		if (!Array.isArray(input.burstWindows)) {
			errors.push("burstWindows must be an array");
		} else {
			input.burstWindows.forEach((w, i) => {
				if (
					!isObject(w) ||
					!isFiniteNumber(w.start) ||
					!isFiniteNumber(w.end) ||
					!(w.end > w.start) ||
					(w.label !== undefined && typeof w.label !== "string")
				) {
					errors.push(
						`burstWindows[${i}]: must have numeric start and end, with end after start`,
					);
				}
			});
		}
	}
	if (!isSimulationEnd(input.end)) {
		errors.push('end must be "lastAction", "settled" or a number');
	}

	if (!Array.isArray(input.partyBuffs)) {
		errors.push("partyBuffs must be an array");
	} else {
		input.partyBuffs.forEach((w, i) => {
			const where = `partyBuffs[${i}]`;
			if (!isObject(w)) {
				errors.push(`${where}: must be an object`);
				return;
			}
			// Only party buffs have marker colors; personal buffs are not valid here.
			if (typeof w.buff !== "string" || getBuffColor(w.buff as BuffType) === undefined) {
				errors.push(`${where}: ${JSON.stringify(w.buff)} is not a party buff`);
			}
			if (!isFiniteNumber(w.time)) errors.push(`${where}: time must be a number`);
			if (w.duration !== undefined && !(isFiniteNumber(w.duration) && w.duration > 0)) {
				errors.push(`${where}: duration must be a positive number`);
			}
		});
	}

	if (!Array.isArray(input.downtime)) {
		errors.push("downtime must be an array");
	} else {
		input.downtime.forEach((w, i) => {
			if (
				!isObject(w) ||
				!isFiniteNumber(w.start) ||
				!isFiniteNumber(w.end) ||
				!(w.end > w.start)
			) {
				errors.push(
					`downtime[${i}]: must have numeric start and end, with end after start`,
				);
			}
		});
	}

	return errors.length > 0
		? { ok: false, errors }
		: { ok: true, value: input as unknown as ScenarioDocument };
}
