import { SkillUnavailableReason } from "../../Game/Common";
import { ActionKey } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { makeDefaultConfig } from "../../Game/GameConfig";
import { getConditionalReplacement } from "../../Game/Skills";
import { RotationSimulator } from "../simulation/RotationSimulator";
import { RotationStep, SimulationOptions } from "../simulation/types";

// What a hotbar button looks like at a point in the rotation, as the in-game hotbar would show it.
export interface ButtonState {
	// The base button (what gets inserted when clicked).
	action: ActionKey;
	// What pressing it would execute now, e.g. Swiftskin's Sting after Reaving Fangs.
	shows: ActionKey;
	// Seconds until usable, shown for oGCDs and charge-based GCDs (not the normal GCD roll),
	// using XIV in the Shell's own hotbar rule.
	cooldown?: number;
	// For actions with charges.
	charges?: { available: number; max: number };
	// False when the action's requirements are not met (e.g. Reawaken without Serpent Offerings).
	// Cooldowns alone do not make a button unusable here; they show as `cooldown`.
	usable: boolean;
	// Proc highlight, as on the XIV in the Shell hotbar.
	highlight: boolean;
}

export interface HotbarState {
	// Display time at which the next inserted action would be pressed (end of the last lock).
	time: number;
	buttons: Map<ActionKey, ButtonState>;
}

const WAITING_ONLY = new Set<string>([
	SkillUnavailableReason.Blocked,
	SkillUnavailableReason.SecondaryBlocked,
]);

// Simulates `steps` (the rotation up to the insertion point) and reads every button's state.
// `countdownExtension` comes from the full rotation's result, so that the prefix runs on the same
// clock: the pull rule may have lengthened the countdown because of actions after the prefix.
export function hotbarStateAfter(
	job: ShellJob,
	steps: RotationStep[],
	actions: ActionKey[],
	options: SimulationOptions,
	countdownExtension = 0,
): HotbarState {
	const countdown = options.config?.countdown ?? makeDefaultConfig(job).countdown;
	const simulator = new RotationSimulator(job, {
		...options,
		config: { ...options.config, countdown: countdown + countdownExtension },
	});
	steps.forEach((step) => simulator.step(step));
	const game = simulator.game;

	const buttons = new Map<ActionKey, ButtonState>();
	for (const action of actions) {
		const shows = getConditionalReplacement(action, game);
		const status = game.getSkillAvailabilityStatus(shows);
		buttons.set(action, {
			action,
			shows,
			cooldown: status.cooldownOverlaySeconds,
			charges:
				status.maxStacks > 1
					? { available: status.stacksAvailable, max: status.maxStacks }
					: undefined,
			usable: status.status.unavailableReasons.every((r) => WAITING_ONLY.has(r)),
			highlight: status.highlight,
		});
	}
	return { time: simulator.displayTime, buttons };
}
