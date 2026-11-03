import { SkillUnavailableReason } from "../../Game/Common";
import { ACTIONS, ActionKey, ResourceKey } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { GameState } from "../../Game/GameState";
import { getConditionalReplacement, getSkill } from "../../Game/Skills";
import { effectiveRanges, enemiesThroughout } from "../rules/targets";
import { SimulatedAction, TargetRange } from "../simulation/types";

// Shared building blocks of the per-job recommenders (docs/rulesets/*-recommendations.md).
// A recommender reads the state after the last pressed action and returns candidates in priority
// order; `arrange` then fits oGCDs into the weave slots. Recommendations are advice only: they never
// change what the engine allows (legality), and every legal action stays insertable.

// Weave slots per GCD. Viper really has 1-3 depending on the GCD; the user chose to assume 2.
export const WEAVE_SLOTS = 2;

export interface Recommendation {
	// The hotbar button to insert.
	action: ActionKey;
	// What pressing it executes now (the engine's replacement), e.g. Swiftskin's Sting for
	// Reaving Fangs after Reaving Fangs.
	shows: ActionKey;
	// The ruleset row that placed it (e.g. "1", "5a"), for debugging.
	rule: string;
	reason: string;
}

export interface Candidate extends Recommendation {
	// oGCDs only: weave slots needed. Undefined for GCDs.
	slots?: number;
	// Follow-up groups (e.g. Twinfang + Twinblood): woven together, and their slots are reserved
	// before other oGCDs, since the next weaponskill would drop them. Members share `group`.
	group?: string;
}

const WAITING_ONLY = new Set<string>([
	SkillUnavailableReason.Blocked,
	SkillUnavailableReason.SecondaryBlocked,
]);
const EPSILON = 1e-6;

export class RecommenderContext {
	readonly job: ShellJob;
	readonly game: GameState;
	// Every action pressed so far, including invalid ones.
	readonly history: readonly SimulatedAction[];
	// Seconds until the next GCD can be pressed (0 if it is ready).
	readonly gcdIn: number;
	// Weave slots left before the next GCD.
	readonly freeSlots: number;
	readonly #targets: TargetRange[];

	constructor(
		job: ShellJob,
		game: GameState,
		history: readonly SimulatedAction[],
		targets: readonly TargetRange[] = [],
	) {
		this.job = job;
		this.game = game;
		this.history = history;
		this.#targets = effectiveRanges(targets);
		this.gcdIn = Math.max(0, game.cooldowns.timeTillAnyStackAvailable("cd_GCD"));
		let woven = 0;
		for (let i = history.length - 1; i >= 0 && !history[i].isGCD; i--) {
			if (history[i].valid) woven++;
		}
		this.freeSlots = Math.max(0, WEAVE_SLOTS - woven);
	}

	// What the button executes now.
	shows(button: ActionKey): ActionKey {
		return getConditionalReplacement(button, this.game);
	}

	isGcd(action: ActionKey): boolean {
		return getSkill(this.job, action).cdName === "cd_GCD";
	}

	// Whether the action can be pressed at its next opportunity: now for oGCDs, when the GCD is
	// ready for GCDs. Requirements must be met; cooldowns (and charges) must be back by then.
	legal(action: ActionKey): boolean {
		const skill = getSkill(this.job, action);
		if (!skill) return false;
		const status = this.game.getSkillAvailabilityStatus(action);
		if (!status.status.unavailableReasons.every((r) => WAITING_ONLY.has(r))) return false;
		const at = this.isGcd(action) ? this.gcdIn : 0;
		const cooldowns = [skill.cdName, skill.secondaryCd?.cdName];
		return cooldowns.every(
			(cd) =>
				cd === undefined ||
				this.game.cooldowns.timeTillAnyStackAvailable(cd) <= at + EPSILON,
		);
	}

	// Enemies the action could hit if pressed at its next opportunity (as in `legal`): those present
	// from the press until its damage lands, the same rule as the damage calculation.
	enemiesFor(action: ActionKey): number {
		const press = this.game.getDisplayTime() + (this.isGcd(action) ? this.gcdIn : 0);
		const skill = getSkill(this.job, action);
		return enemiesThroughout(this.#targets, press, press + (skill?.applicationDelay ?? 0));
	}

	// The engine's proc highlight (Honed buffs, venoms, next Generation, ...).
	highlighted(action: ActionKey): boolean {
		return this.game.getSkillAvailabilityStatus(action).highlight;
	}

	has(key: ResourceKey): boolean {
		return this.game.hasResourceAvailable(key);
	}

	amount(key: ResourceKey): number {
		return this.game.resources.get(key).availableAmount();
	}

	// Seconds left on a timed resource; 0 if it is not up.
	timer(key: ResourceKey): number {
		return this.has(key) ? this.game.resources.timeTillReady(key) : 0;
	}

	// The action's GCD recast under the current state (speed buffs included); 0 for abilities.
	recast(action: ActionKey): number {
		const skill = getSkill(this.job, action);
		return "recastTimeFn" in skill ? skill.recastTimeFn(this.game) : 0;
	}

	lastGcd(): SimulatedAction | undefined {
		for (let i = this.history.length - 1; i >= 0; i--) {
			if (this.history[i].isGCD && this.history[i].valid) return this.history[i];
		}
		return undefined;
	}
}

export function actionLabel(action: ActionKey): string {
	return ACTIONS[action]?.name ?? action;
}

// Removes duplicates (the higher entry wins) and fits oGCDs into the free weave slots. Follow-up
// groups claim their slots first, as a whole; an oGCD that does not fit moves below the first GCD
// with the reason "no weave slot".
export function arrange(candidates: Candidate[], freeSlots: number): Recommendation[] {
	const seen = new Set<string>();
	const unique = candidates.filter((c) => {
		const key = `${c.action}>${c.shows}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const fits = new Set<Candidate>();
	let left = freeSlots;
	const groups = new Map<string, Candidate[]>();
	for (const c of unique) {
		if (c.slots !== undefined && c.group !== undefined) {
			groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
		}
	}
	for (const members of groups.values()) {
		const need = members.reduce((sum, c) => sum + (c.slots ?? 0), 0);
		if (need <= left) {
			left -= need;
			members.forEach((c) => fits.add(c));
		}
	}
	for (const c of unique) {
		if (c.slots !== undefined && c.group === undefined && c.slots <= left) {
			left -= c.slots;
			fits.add(c);
		}
	}

	const strip = ({ action, shows, rule, reason }: Candidate): Recommendation => ({
		action,
		shows,
		rule,
		reason,
	});
	const out: Recommendation[] = [];
	let waiting: Recommendation[] = [];
	let gcdPlaced = false;
	for (const c of unique) {
		const isGcd = c.slots === undefined;
		if (!isGcd && !fits.has(c)) {
			const deferred = { ...strip(c), reason: `${c.reason}; no weave slot` };
			if (gcdPlaced) out.push(deferred);
			else waiting.push(deferred);
			continue;
		}
		out.push(strip(c));
		if (isGcd && !gcdPlaced) {
			gcdPlaced = true;
			out.push(...waiting);
			waiting = [];
		}
	}
	return [...out, ...waiting];
}
