import { SkillUnavailableReason, Warning } from "../../Game/Common";
import { GameState } from "../../Game/GameState";
import { Potency } from "../../Game/Potency";
import { SimulationHost } from "../../Game/SimulationHost";
import { ActionNode } from "../../Controller/Record";

// Per-simulation replacement for the global controller's event sinks.
// Potencies are stamped with the attached game's clock, and nothing leaves this object.
export class RecordingHost implements SimulationHost {
	#game?: GameState;
	readonly resolvedPotencies: Potency[] = [];
	readonly warnings: Warning[] = [];

	// No downtime and no party buff markers are modeled yet.
	readonly timeline = {
		duringUntargetable: (_displayTime: number) => false,
		nextTargetableAfter: (displayTime: number) => displayTime,
		getBuffMarkers: () => [],
	};

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
