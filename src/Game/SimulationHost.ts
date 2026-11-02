import { Warning } from "./Common";
import { Potency, PotencyKind } from "./Potency";
import { ActionNode } from "../Controller/Record";
import { ResourceKey } from "./Data";

// Receives the events a GameState produces while it runs, and answers the few encounter
// questions the engine asks (downtime, party buff markers).
// The global Controller satisfies this interface structurally and is the default host, so
// the main application is unaffected. Headless simulations supply their own host so that
// several GameStates can run without sharing state through the controller singleton.
export interface SimulationHost {
	resolvePotency(p: Potency): void;
	resolveHealingPotency(p: Potency): void;
	resolveOverTimePotency(p: Potency, kind: PotencyKind): void;
	reportWarning(type: Warning): void;
	reportInterruption(props: { failNode: ActionNode; failIndex: number }): void;
	reportManaTick(time: number, sourceDesc: string): void;
	reportLucidTick(time: number, sourceDesc: string): void;
	reportAutoTick(time: number): void;
	reportDotTick(rawTime: number, dotName?: ResourceKey): void;
	reportHotTick(rawTime: number, hotName?: ResourceKey): void;
	reportOverTimeStart(
		displayTime: number,
		effect: ResourceKey,
		kind: PotencyKind,
		targetList: number[],
	): void;
	reportOverTimeDrop(
		displayTime: number,
		effect: ResourceKey,
		kind: PotencyKind,
		targetList: number[],
	): void;
	timeline: {
		duringUntargetable(displayTime: number): boolean;
		nextTargetableAfter(displayTime: number): number;
		getBuffMarkers(): { time: number; duration: number; description: string }[];
	};
}
