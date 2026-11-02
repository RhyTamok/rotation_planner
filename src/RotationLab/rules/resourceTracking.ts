import { ActionKey, ResourceKey, RESOURCES } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { VPR_STATUSES, VPRResourceKey } from "../../Game/Data/Jobs/VPR";
import { GameState } from "../../Game/GameState";
import { getSkillAssetPath } from "../../Game/Skills";

// Which resources the editor shows for each job, mirroring the job's gauge in XIV in the Shell
// (Components/Jobs/<job>.tsx). Gauges are shown in every row; timers are shown for the selected row.

interface TrackedTimer {
	label: string;
	// Path under /assets/.
	icon: string;
	isCombo?: boolean;
	// The timer shows the longest remaining time among these resources while any is active.
	keys: ResourceKey[];
}

// A combo tracked for break notes: its resource holds the current step (0 = no combo running).
interface TrackedCombo {
	key: ResourceKey;
	label: string;
	// Actions that end the combo by completing it rather than breaking it.
	finishers: ActionKey[];
}

interface JobTracking {
	gauges: ResourceKey[];
	timers: TrackedTimer[];
	combos: TrackedCombo[];
}

// Buff icons live where XIV in the Shell registers them (Components/Jobs/<job>.tsx).
const statusTimers = (folder: string, keys: ResourceKey[]): TrackedTimer[] =>
	keys.map((key) => ({
		label: RESOURCES[key].name,
		icon: `Buffs/${folder}/${RESOURCES[key].name}.png`,
		keys: [key],
	}));

const TRACKING: Partial<Record<ShellJob, JobTracking>> = {
	VPR: {
		gauges: ["RATTLING_COIL", "SERPENT_OFFERINGS", "ANGUINE_TRIBUTE"],
		timers: [
			// Combo timers have no buff icon; they use the skill that starts the combo.
			{
				label: "Dual Wield Combo",
				icon: `Skills/${getSkillAssetPath("VPR", "STEEL_FANGS")}`,
				isCombo: true,
				keys: ["VPR_COMBO", "VPR_AOE_COMBO"],
			},
			{
				label: "Twinblade Combo",
				icon: `Skills/${getSkillAssetPath("VPR", "HUNTERS_COIL")}`,
				isCombo: true,
				keys: [
					"HUNTERS_COIL_READY",
					"SWIFTSKINS_COIL_READY",
					"HUNTERS_DEN_READY",
					"SWIFTSKINS_DEN_READY",
				],
			},
			...statusTimers("VPR", Object.keys(VPR_STATUSES) as VPRResourceKey[]),
			...statusTimers("General", ["TINCTURE"]),
		],
		// The Fang and Maw combos are mutually exclusive: starting one cancels the other.
		combos: [
			{
				key: "VPR_COMBO",
				label: "single-target combo",
				finishers: [
					"FLANKSTING_STRIKE",
					"FLANKSBANE_FANG",
					"HINDSTING_STRIKE",
					"HINDSBANE_FANG",
				],
			},
			{
				key: "VPR_AOE_COMBO",
				label: "AoE combo",
				finishers: ["JAGGED_MAW", "BLOODIED_MAW"],
			},
		],
	},
};

export function comboSteps(game: GameState): number[] {
	return (TRACKING[game.job]?.combos ?? []).map((c) =>
		game.resources.get(c.key).availableAmount(),
	);
}

// Labels of the combos that were running before `action` (steps from comboSteps) and that the
// action cancelled without finishing.
export function brokenCombos(game: GameState, before: number[], action: ActionKey): string[] {
	const after = comboSteps(game);
	return (TRACKING[game.job]?.combos ?? [])
		.filter((c, i) => before[i] > 0 && after[i] === 0 && !c.finishers.includes(action))
		.map((c) => c.label);
}

export interface GaugeValue {
	key: ResourceKey;
	label: string;
	amount: number;
	max: number;
}

export interface TimerValue {
	label: string;
	icon: string;
	// Seconds left; undefined for an active resource with no expiry.
	remaining?: number;
	stacks: number;
}

export interface ResourceSnapshot {
	gauges: GaugeValue[];
	// Only the active timers, soonest to expire first; timers without expiry last.
	timers: TimerValue[];
}

export function trackedGauges(job: ShellJob): { key: ResourceKey; label: string }[] {
	return (TRACKING[job]?.gauges ?? []).map((key) => ({ key, label: RESOURCES[key].name }));
}

export function snapshotResources(game: GameState): ResourceSnapshot {
	const tracking = TRACKING[game.job];
	if (!tracking) return { gauges: [], timers: [] };
	const gauges = tracking.gauges.map((key) => {
		const rsc = game.resources.get(key);
		return {
			key,
			label: RESOURCES[key].name,
			amount: rsc.availableAmount(),
			max: rsc.maxValue,
		};
	});
	const timers: TimerValue[] = [];
	for (const timer of tracking.timers) {
		const active = timer.keys
			.map((key) => game.resources.get(key))
			.filter((rsc) => rsc.available(1));
		if (active.length === 0) continue;
		const remaining = active
			.map((rsc) => rsc.pendingChange?.timeTillEvent)
			.filter((t): t is number => t !== undefined);
		timers.push({
			label: timer.label,
			icon: timer.icon,
			remaining: remaining.length > 0 ? Math.max(...remaining) : undefined,
			// A combo tracker's amount is the combo step, not a stack count.
			stacks: timer.isCombo ? 1 : Math.max(...active.map((rsc) => rsc.availableAmount())),
		});
	}
	timers.sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity));
	return { gauges, timers };
}
