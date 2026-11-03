import { BuffType, Warning } from "../../Game/Common";
import { ConfigData } from "../../Game/GameConfig";
import { ActionKey } from "../../Game/Data";
import { PotencyModifierType } from "../../Game/Potency";
import { GemdraughtGrade } from "../damage/DamageModel";
import { ResourceSnapshot } from "../rules/resourceTracking";

// Units: every time in this module is engine *display time* in seconds, the same clock the
// XIV in the Shell UI shows (negative during the countdown, 0 at the pull).

export type RotationStep =
	// `delay`: extra seconds to wait after the action first becomes usable (normally the end of
	// the previous animation lock), e.g. to place an oGCD later in a GCD gap.
	| { type: "skill"; action: ActionKey; targets?: number[]; delay?: number }
	// Idle for a fixed duration.
	| { type: "wait"; seconds: number }
	// Idle until the given display time; invalid if that time has already passed.
	| { type: "jumpTo"; displayTime: number };

export interface RotationInput {
	id: string;
	// A bare ActionKey is shorthand for { type: "skill", action }.
	steps: (ActionKey | RotationStep)[];
}

// Where the simulation stops before results are collected.
// - "lastAction": at the end of the last step's animation lock, matching what the
//   XIV in the Shell controller reports after loading a timeline.
// - "settled": additionally wait until every action's damage has landed.
// - number: a common fight cutoff (display time). Damage landing after it is pending.
export type SimulationEnd = "lastAction" | "settled" | number;

// An external party buff (e.g. Battle Litany, Technical Finish) active from `time`.
// `duration` defaults to the buff's standard duration.
export interface PartyBuffWindow {
	buff: BuffType;
	time: number;
	duration?: number;
}

// A window during which the boss is untargetable: autos pause and hits landing inside it deal
// no damage, as in XIV in the Shell with its untargetable mask enabled. `end` is exclusive.
export interface DowntimeWindow {
	start: number;
	end: number;
}

// `enemies` (the main target included) are present from `start` (inclusive) to `end` (exclusive).
// Outside every range only the main target is present. See rules/targets.ts.
export interface TargetRange {
	start: number;
	end: number;
	enemies: number;
}

export interface SimulationOptions {
	partyBuffs?: PartyBuffWindow[];
	downtime?: DowntimeWindow[];
	// Extra enemies over time. A skill step without explicit `targets` hits as many as are present
	// from its press to its damage application (fewer if some leave in between).
	targets?: TargetRange[];
	// Merged over the job's default config (not the BLM-based DEFAULT_CONFIG).
	// Character stats for expected damage (main, wd, partyBonus, criticalHit, ...) come from here.
	config?: Partial<ConfigData>;
	// Flat potency multiplier for tincture, as XIV in the Shell reports it (1.08 for 8%).
	// Only affects the potency fields; expected damage models tincture via `tinctureGrade`.
	tincturePotencyMultiplier?: number;
	// Gemdraught grade used for expected damage. Defaults to 4.
	tinctureGrade?: GemdraughtGrade;
	// Weapon delay in seconds; drives auto-attack timing and damage. Defaults to the job's value.
	weaponDelay?: number;
	end?: SimulationEnd;
	// Enforce the Lab's pull and downtime rules (rules/encounterRules.ts). Off by default so that
	// plain simulations stay comparable with the upstream controller.
	encounterRules?: boolean;
}

export interface SimulatedAction {
	stepIndex: number;
	requestedAction: ActionKey;
	executedAction: ActionKey;
	startTime: number;
	lockEndTime: number;
	isGCD: boolean;
	valid: boolean;
	// Engine reasons (SkillUnavailableReason) or Lab encounter rules (EncounterViolation).
	invalidReasons: string[];
	// Seconds the action was held so that its damage lands exactly at the pull (0 s).
	pullHold?: number;
	// GCDs only: seconds between the GCD becoming ready and this GCD being pressed.
	gcdDelay?: number;
	// True if that delay came from the animation lock of the oGCD just before (a clip), rather
	// than from a deliberate wait or delay.
	clipped?: boolean;
	// Set if the action's damage landed while the boss was untargetable ("ghosted"): its effects
	// applied but it dealt no damage. Seconds between the start of that downtime and the landing.
	ghostedBy?: number;
	// Combos (by label, e.g. "single-target combo") this action cancelled without finishing.
	comboBreaks?: string[];
	// Gauges and timers at the end of this action's animation lock.
	resources: ResourceSnapshot;
	// Potency (including DoT ticks) that landed before the simulation stopped.
	appliedPotency: number;
	// Potency that snapshotted but had not landed yet.
	pendingPotency: number;
	// Expected damage counterparts; undefined when the damage model does not support the job/level.
	expectedDamage?: number;
	pendingDamage?: number;
	// Enemies the action's own hit struck (0 for actions without a damaging hit). Single-target
	// actions always hit 1.
	targetsHit: number;
	modifiers: PotencyModifierType[];
}

export interface DamageEvent {
	time: number;
	source: ActionKey;
	potency: number;
	expectedDamage?: number;
	isAutoAttack: boolean;
	// False if the hit landed during downtime and dealt no damage.
	hitTarget: boolean;
}

export interface DamageTotals {
	// Landed before the simulation stopped.
	expectedDamage: number;
	autoAttackDamage: number;
	// Snapshotted but not yet landed.
	pendingDamage: number;
	// expectedDamage / endTime, measured from the pull (display time 0). Undefined if endTime <= 0.
	expectedDps?: number;
}

export interface StepError {
	stepIndex: number;
	message: string;
}

export interface RotationResult {
	id: string;
	// False if any step was invalid. Invalid skills still roll their locks, as in upstream replay.
	valid: boolean;
	endTime: number;
	// With encounter rules: seconds added to the countdown because the first hit would otherwise
	// have landed after 0 s. Pre-pull actions moved earlier by this much.
	countdownExtension?: number;
	actions: SimulatedAction[];
	damageEvents: DamageEvent[];
	warnings: Warning[];
	errors: StepError[];
	totals: {
		appliedPotency: number;
		pendingPotency: number;
		appliedPotencyWithoutPot: number;
		autoAttackPotency: number;
		gcdCount: number;
	};
	// Undefined when the damage model has no verified constants for the job/level.
	damage?: DamageTotals;
	// The encounter conditions this result was simulated under, with buff durations resolved,
	// so comparisons can show exactly what each rotation assumed.
	encounter: {
		partyBuffs: Required<PartyBuffWindow>[];
		downtime: DowntimeWindow[];
	};
}
