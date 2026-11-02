import { SkillUnavailableReason, Warning } from "../../Game/Common";
import { GameState } from "../../Game/GameState";
import { Potency } from "../../Game/Potency";
import { SimulationHost } from "../../Game/SimulationHost";
import { ActionNode } from "../../Controller/Record";
import { DowntimeWindow, PartyBuffWindow } from "./types";

// Per-simulation replacement for the global controller's event sinks.
// Potencies are stamped with the attached game's clock, and nothing leaves this object.
export class RecordingHost implements SimulationHost {
	#game?: GameState;
	readonly resolvedPotencies: Potency[] = [];
	readonly warnings: Warning[] = [];

	readonly timeline: SimulationHost["timeline"];

	// Windows use the same semantics as the upstream Timeline: buff markers are matched by
	// GameState.getPartyBuffs, and untargetable windows exclude their end time.
	constructor(
		encounter: {
			partyBuffs?: Required<PartyBuffWindow>[];
			downtime?: DowntimeWindow[];
		} = {},
	) {
		const buffMarkers = (encounter.partyBuffs ?? []).map((w) => ({
			time: w.time,
			duration: w.duration,
			description: w.buff,
		}));
		const downtime = [...(encounter.downtime ?? [])].sort((a, b) => a.start - b.start);
		this.timeline = {
			getBuffMarkers: () => buffMarkers,
			duringUntargetable: (displayTime: number) =>
				downtime.some((w) => displayTime >= w.start && displayTime < w.end),
			// Mirrors Timeline.nextTargetableAfter.
			nextTargetableAfter: (displayTime: number) => {
				for (const w of downtime) {
					if (w.start > displayTime) {
						return displayTime;
					}
					if (displayTime < w.end) {
						return w.end;
					}
				}
				return displayTime;
			},
		};
	}

	attach(game: GameState) {
		this.#game = game;
	}

	get game(): GameState {
		if (!this.#game) {
			throw new Error("RecordingHost used before a game was attached");
		}
		return this.#game;
	}

	resolvePotency(p: Potency) {
		this.#resolve(p);
	}

	resolveHealingPotency(p: Potency) {
		// Healing is outside the scope of damage comparison, but must still be marked as landed.
		p.resolve(this.game.getDisplayTime());
	}

	resolveOverTimePotency(p: Potency) {
		this.#resolve(p);
	}

	#resolve(p: Potency | undefined) {
		// Mirrors the controller's guard against DoTs imported under the wrong job.
		if (p === undefined) {
			return;
		}
		p.resolve(this.game.getDisplayTime());
		this.resolvedPotencies.push(p);
	}

	reportWarning(type: Warning) {
		this.warnings.push(type);
	}

	// Upstream marks the interrupted cast invalid during replay; do the same on the node.
	reportInterruption(props: { failNode: ActionNode; failIndex: number }) {
		props.failNode.tmp_invalid_reasons = [SkillUnavailableReason.CastCanceled];
	}

	// Timeline decorations and DoT coverage bookkeeping are UI concerns; ignore them.
	reportManaTick() {}
	reportLucidTick() {}
	reportAutoTick() {}
	reportDotTick() {}
	reportHotTick() {}
	reportOverTimeStart() {}
	reportOverTimeDrop() {}
}
