import { ResourceKey, RESOURCES } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { VPR_STATUSES, VPRResourceKey } from "../../Game/Data/Jobs/VPR";
import { GameState } from "../../Game/GameState";

// Which resources the editor shows for each job, mirroring the job's gauge in XIV in the Shell
// (Components/Jobs/<job>.tsx). Gauges are shown in every row; timers are shown for the selected row.

interface TrackedTimer {
	label: string;
	// The timer shows the longest remaining time among these resources while any is active.
	keys: ResourceKey[];
}

interface JobTracking {
	gauges: ResourceKey[];
	timers: TrackedTimer[];
}

const statusTimers = (keys: ResourceKey[]): TrackedTimer[] =>
	keys.map((key) => ({ label: RESOURCES[key].name, keys: [key] }));

const TRACKING: Partial<Record<ShellJob, JobTracking>> = {
	VPR: {
		gauges: ["RATTLING_COIL", "SERPENT_OFFERINGS", "ANGUINE_TRIBUTE"],
		timers: [
			{ label: "Dual Wield Combo", keys: ["VPR_COMBO", "VPR_AOE_COMBO"] },
			{
				label: "Twinblade Combo",
				keys: [
					"HUNTERS_COIL_READY",
					"SWIFTSKINS_COIL_READY",
					"HUNTERS_DEN_READY",
					"SWIFTSKINS_DEN_READY",
				],
			},
			...statusTimers(Object.keys(VPR_STATUSES) as VPRResourceKey[]),
			...statusTimers(["TINCTURE"]),
		],
	},
};

export interface GaugeValue {
	key: ResourceKey;
	label: string;
	amount: number;
	max: number;
}

export interface TimerValue {
	label: string;
	// Seconds left; undefined for an active resource with no expiry.
	remaining?: number;
	stacks: number;
}

export interface ResourceSnapshot {
	gauges: GaugeValue[];
	// Only the active timers.
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
			remaining: remaining.length > 0 ? Math.max(...remaining) : undefined,
			stacks: Math.max(...active.map((rsc) => rsc.availableAmount())),
		});
	}
	return { gauges, timers };
}
