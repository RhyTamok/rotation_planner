import { getBuffColor, Buff } from "../../Game/Buffs";
import { BuffType } from "../../Game/Common";
import { ShellJob } from "../../Game/Data/Jobs";
import { PartyBuffWindow } from "../simulation/types";

// Party buff windows grouped into one display lane per buff, for the editor's buff column.
export interface BuffLane {
	buff: BuffType;
	// XIV in the Shell's timeline marker color for the buff.
	color: string;
	// Path under /assets/: the buff's status icon, filed under the job that grants it.
	icon: string;
	windows: Required<PartyBuffWindow>[];
}

export interface LaneCoverage {
	window: Required<PartyBuffWindow>;
	// Seconds of the window left at the queried time.
	remaining: number;
	// True for the first covered row of a window, where the icon is drawn.
	first: boolean;
}

// Lanes in order of each buff's first appearance.
export function buffLanes(job: ShellJob, windows: Required<PartyBuffWindow>[]): BuffLane[] {
	const lanes = new Map<BuffType, BuffLane>();
	for (const w of [...windows].sort((a, b) => a.time - b.time)) {
		let lane = lanes.get(w.buff);
		if (!lane) {
			const info = new Buff(w.buff, job).info;
			lane = {
				buff: w.buff,
				color: getBuffColor(w.buff) ?? "#6f6f6f",
				icon: `Buffs/${info.job}/${w.buff}.png`,
				windows: [],
			};
			lanes.set(w.buff, lane);
		}
		lane.windows.push(w);
	}
	return [...lanes.values()];
}

// Which window of the lane (if any) covers each of the given action start times. Upstream
// snapshots party buffs when the action is used, so the start time decides coverage, with both
// ends of the window inclusive as in GameState.getPartyBuffs.
export function laneCoverage(lane: BuffLane, times: number[]): (LaneCoverage | undefined)[] {
	const seen = new Set<Required<PartyBuffWindow>>();
	return times.map((t) => {
		const window = lane.windows.find((w) => t >= w.time && t <= w.time + w.duration);
		if (!window) return undefined;
		const first = !seen.has(window);
		seen.add(window);
		return { window, remaining: window.time + window.duration - t, first };
	});
}
