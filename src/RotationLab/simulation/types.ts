import { SkillUnavailableReason, Warning } from "../../Game/Common";
import { ConfigData } from "../../Game/GameConfig";
import { ActionKey } from "../../Game/Data";
import { PotencyModifierType } from "../../Game/Potency";

// Units: every time in this module is engine *display time* in seconds, the same clock the
// XIV in the Shell UI shows (negative during the countdown, 0 at the pull).

export type RotationStep =
	| { type: "skill"; action: ActionKey; targets?: number[] }
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

export interface SimulationOptions {
	// Merged over the job's default config (not the BLM-based DEFAULT_CONFIG).
	config?: Partial<ConfigData>;
	// 1.08 for an 8% tincture. Defaults to 1.
	tincturePotencyMultiplier?: number;
	end?: SimulationEnd;
}

export interface SimulatedAction {
	stepIndex: number;
	requestedAction: ActionKey;
	executedAction: ActionKey;
	startTime: number;
	lockEndTime: number;
	isGCD: boolean;
	valid: boolean;
	invalidReasons: SkillUnavailableReason[];
	// Potency (including DoT ticks) that landed before the simulation stopped.
	appliedPotency: number;
	// Potency that snapshotted but had not landed yet.
	pendingPotency: number;
	modifiers: PotencyModifierType[];
}

export interface DamageEvent {
	time: number;
	source: ActionKey;
	potency: number;
	isAutoAttack: boolean;
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
	// Encounter features this milestone does not model yet; results assume none of them.
	assumptions: {
		partyBuffs: false;
		downtime: false;
	};
}
