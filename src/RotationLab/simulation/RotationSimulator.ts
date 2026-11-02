import { SkillUnavailableReason } from "../../Game/Common";
import { GameConfig, makeDefaultConfig } from "../../Game/GameConfig";
import { GameState } from "../../Game/GameState";
import { getGameState } from "../../Game/Jobs";
import { getConditionalReplacement, getSkill } from "../../Game/Skills";
import { ShellJob } from "../../Game/Data/Jobs";
import { ActionKey } from "../../Game/Data";
import { ActionNode, skillNode } from "../../Controller/Record";
import { RecordingHost } from "./RecordingHost";
import {
	DamageEvent,
	RotationInput,
	RotationResult,
	RotationStep,
	SimulatedAction,
	SimulationEnd,
	SimulationOptions,
	StepError,
} from "./types";

// Upper bound for "settled" so a pathological rotation cannot loop forever.
const MAX_SETTLE_SECONDS = 60;
const SETTLE_STEP_SECONDS = 0.5;

interface ExecutedSkill {
	stepIndex: number;
	requestedAction: ActionKey;
	executedAction: ActionKey;
	node: ActionNode;
	startTime: number;
	lockEndTime: number;
	isGCD: boolean;
}

// One independent simulation: its own GameConfig, GameState and host.
// Nothing here reads or writes the global controller, so any number of simulators may be
// alive and advanced in any order.
export class RotationSimulator {
	readonly game: GameState;
	readonly host: RecordingHost;
	readonly #tincturePotencyMultiplier: number;
	#executed: ExecutedSkill[] = [];
	#errors: StepError[] = [];
	#stepCount = 0;

	constructor(job: ShellJob, options: SimulationOptions = {}) {
		const config = new GameConfig({ ...makeDefaultConfig(job), ...options.config, job });
		this.host = new RecordingHost();
		this.game = getGameState(config, this.host);
		this.host.attach(this.game);
		// Same as Controller.#applyResourceOverrides after a restart.
		config.initialResourceOverrides.forEach((override) => override.applyTo(this.game));
		this.#tincturePotencyMultiplier = options.tincturePotencyMultiplier ?? 1;
	}

	get displayTime(): number {
		return this.game.getDisplayTime();
	}

	step(step: ActionKey | RotationStep) {
		const stepIndex = this.#stepCount++;
		const normalized: RotationStep =
			typeof step === "string" ? { type: "skill", action: step } : step;
		if (normalized.type === "skill") {
			this.#useSkill(stepIndex, normalized.action, normalized.targets ?? [1]);
		} else if (normalized.type === "wait") {
			this.#tick(normalized.seconds);
		} else {
			const delta = normalized.displayTime - this.game.getDisplayTime();
			if (delta >= 0) {
				this.#tick(delta);
			} else {
				this.#errors.push({
					stepIndex,
					message: `${SkillUnavailableReason.PastTargetTime}: jump to ${normalized.displayTime} at ${this.game.getDisplayTime()}`,
				});
			}
		}
	}

	// Mirrors Controller.#useSkill in manual tick mode, including its handling of invalid skills.
	#useSkill(stepIndex: number, requestedAction: ActionKey, targetList: number[]) {
		let status = this.game.getSkillAvailabilityStatus(requestedAction);
		this.#tick(status.timeTillAvailable);

		const executedAction = getConditionalReplacement(requestedAction, this.game);
		status = this.game.getSkillAvailabilityStatus(executedAction);
		const node = skillNode(executedAction, this.#filterTargetList(targetList, executedAction));
		const actionIndex = this.#executed.length;

		node.tmp_startLockTime = this.game.time;
		if (status.status.ready()) {
			this.game.useSkill(executedAction, node, actionIndex);
			node.tmp_invalid_reasons = [];
		} else {
			this.game.useInvalidSkill(executedAction, node);
			node.tmp_invalid_reasons = status.status.unavailableReasons;
		}
		const lockDuration = this.game.timeTillAnySkillAvailable();
		node.tmp_startLockTime = this.game.time;
		node.tmp_endLockTime = this.game.time + lockDuration;

		this.#executed.push({
			stepIndex,
			requestedAction,
			executedAction,
			node,
			startTime: this.game.getDisplayTime(),
			lockEndTime: this.game.getDisplayTime() + lockDuration,
			isGCD: this.game.skillsList.get(executedAction).cdName === "cd_GCD",
		});

		// Manual mode fast-forwards to the end of the animation lock.
		this.#tick(lockDuration);
	}

	// Same rules as Controller.filterTargetList, evaluated against this simulation's game.
	#filterTargetList(targetList: number[], skillName: ActionKey): number[] {
		const skill = getSkill(this.game.job, skillName);
		if (
			skill?.potencyFn(this.game) === 0 &&
			!skill?.savesTargets &&
			!this.game.dotSkills.includes(skillName) &&
			skillName !== "CHAIN_STRATAGEM"
		) {
			return [];
		}
		return targetList;
	}

	#tick(deltaTime: number) {
		if (deltaTime > 0) {
			this.game.tick(deltaTime);
		}
	}

	#hasPendingActionDamage(): boolean {
		return this.#executed.some(
			({ node }) => this.#nodePotency(node).snapshottedButPending > 0 || !node.resolved(),
		);
	}

	finish(end: SimulationEnd = "lastAction") {
		if (typeof end === "number") {
			this.#tick(end - this.game.getDisplayTime());
		} else if (end === "settled") {
			let waited = 0;
			while (this.#hasPendingActionDamage() && waited < MAX_SETTLE_SECONDS) {
				this.#tick(SETTLE_STEP_SECONDS);
				waited += SETTLE_STEP_SECONDS;
			}
		}
	}

	#nodePotency(node: ActionNode, tincturePotencyMultiplier = this.#tincturePotencyMultiplier) {
		return node.getPotency({
			tincturePotencyMultiplier,
			untargetable: () => false,
			includePartyBuffs: false,
			includeSplash: true,
		});
	}

	result(id: string): RotationResult {
		const actions: SimulatedAction[] = this.#executed.map((e) => {
			const potency = this.#nodePotency(e.node);
			return {
				stepIndex: e.stepIndex,
				requestedAction: e.requestedAction,
				executedAction: e.executedAction,
				startTime: e.startTime,
				lockEndTime: e.lockEndTime,
				isGCD: e.isGCD,
				valid: e.node.tmp_invalid_reasons.length === 0,
				invalidReasons: [...e.node.tmp_invalid_reasons],
				appliedPotency: potency.applied,
				pendingPotency: potency.snapshottedButPending,
				modifiers: (e.node.getInitialPotency()?.getDisplayedModifiers() ?? []).map(
					(m) => m.source,
				),
			};
		});

		// Totals follow the conventions of upstream calculateDamageStats (auto-attacks included).
		const allNodes = [...this.#executed.map((e) => e.node), ...this.game.fakeAutoActionNodes];
		let appliedPotency = 0;
		let pendingPotency = 0;
		let appliedPotencyWithoutPot = 0;
		let autoAttackPotency = 0;
		for (const node of allNodes) {
			const potency = this.#nodePotency(node);
			appliedPotency += potency.applied;
			pendingPotency += potency.snapshottedButPending;
			if (node.resolved()) {
				appliedPotencyWithoutPot += this.#nodePotency(node, 1).applied;
			}
			if (node.maybeGetActionKey() === "ATTACK") {
				autoAttackPotency += potency.applied;
			}
		}
		const gcdCount = this.#executed.filter(
			(e) => e.isGCD && e.node.hitBoss(() => false),
		).length;

		const damageEvents: DamageEvent[] = this.host.resolvedPotencies.map((p) => ({
			time: p.applicationTime!,
			source: p.sourceSkill,
			potency: p.getAmount({
				tincturePotencyMultiplier: this.#tincturePotencyMultiplier,
				includePartyBuffs: false,
				includeSplash: true,
			}),
			isAutoAttack: p.sourceSkill === "ATTACK",
		}));

		return {
			id,
			valid: this.#errors.length === 0 && actions.every((a) => a.valid),
			endTime: this.game.getDisplayTime(),
			actions,
			damageEvents,
			warnings: [...this.host.warnings],
			errors: [...this.#errors],
			totals: {
				appliedPotency,
				pendingPotency,
				appliedPotencyWithoutPot,
				autoAttackPotency,
				gcdCount,
			},
			assumptions: { partyBuffs: false, downtime: false },
		};
	}
}

export function simulateRotation(
	input: RotationInput,
	options: SimulationOptions = {},
	job: ShellJob = "VPR",
): RotationResult {
	const simulator = new RotationSimulator(job, options);
	input.steps.forEach((step) => simulator.step(step));
	simulator.finish(options.end);
	return simulator.result(input.id);
}
