import { SkillUnavailableReason } from "../../Game/Common";
import { GameConfig, makeDefaultConfig } from "../../Game/GameConfig";
import { GameState } from "../../Game/GameState";
import { getGameState } from "../../Game/Jobs";
import { getConditionalReplacement, getSkill } from "../../Game/Skills";
import { ShellJob } from "../../Game/Data/Jobs";
import { ActionKey } from "../../Game/Data";
import { Potency, PotencyModifierType } from "../../Game/Potency";
import { Buff } from "../../Game/Buffs";
import { ActionNode, skillNode } from "../../Controller/Record";
import { DamageModel, getDefaultWeaponDelay, isDamageModelSupported } from "../damage/DamageModel";
import { RecordingHost } from "./RecordingHost";
import {
	DamageEvent,
	DamageTotals,
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
	// Undefined when there are no verified damage constants for this job/level.
	readonly damageModel?: DamageModel;
	readonly #tinctureBonus: number;
	readonly #encounter: RotationResult["encounter"];
	#executed: ExecutedSkill[] = [];
	#errors: StepError[] = [];
	#stepCount = 0;

	constructor(job: ShellJob, options: SimulationOptions = {}) {
		const config = new GameConfig({ ...makeDefaultConfig(job), ...options.config, job });
		for (const w of options.downtime ?? []) {
			if (!(w.end > w.start)) {
				throw new Error(`Downtime window must end after it starts: ${w.start} to ${w.end}`);
			}
		}
		this.#encounter = {
			partyBuffs: (options.partyBuffs ?? []).map((w) => ({
				buff: w.buff,
				time: w.time,
				duration: w.duration ?? new Buff(w.buff, job).info.duration,
			})),
			downtime: (options.downtime ?? []).map((w) => ({ ...w })),
		};
		this.host = new RecordingHost(this.#encounter);
		this.game = getGameState(config, this.host);
		this.host.attach(this.game);
		// Same as Controller.#applyResourceOverrides after a restart.
		config.initialResourceOverrides.forEach((override) => override.applyTo(this.game));
		this.#tincturePotencyMultiplier = options.tincturePotencyMultiplier ?? 1;

		const weaponDelay = options.weaponDelay ?? getDefaultWeaponDelay(job);
		if (weaponDelay !== undefined) {
			this.game.setWeaponDelay(weaponDelay);
		}
		if (weaponDelay !== undefined && isDamageModelSupported(job, config.level)) {
			this.damageModel = new DamageModel(job, {
				level: config.level,
				main: config.main,
				wd: config.wd,
				weaponDelay,
				partyBonus: config.partyBonus,
				criticalHit: config.criticalHit,
				directHit: config.directHit,
				determination: config.determination,
				skillSpeed: config.skillSpeed,
				tenacity: config.tenacity,
			});
		}
		this.#tinctureBonus = this.damageModel?.tinctureBonus(options.tinctureGrade ?? 4) ?? 0;
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

	// Hits landing while the boss is untargetable deal no damage.
	readonly #untargetable = (displayTime: number) =>
		this.host.timeline.duringUntargetable(displayTime);

	#nodePotency(
		node: ActionNode,
		tincturePotencyMultiplier = this.#tincturePotencyMultiplier,
		includePartyBuffs = true,
	) {
		return node.getPotency({
			tincturePotencyMultiplier,
			untargetable: this.#untargetable,
			includePartyBuffs,
			includeSplash: true,
		});
	}

	// Expected damage of one hit. The engine's potency amount is the base potency scaled by buffs
	// relative to the unbuffed crit/DH expectation; that ratio is applied on top of the floored
	// damage chain, followed by the character's own crit/DH expectation.
	#expectedDamage(model: DamageModel, p: Potency): number {
		if (p.base === 0) {
			return 0;
		}
		const engineAmount = p.getAmount({
			tincturePotencyMultiplier: 1,
			includePartyBuffs: true,
			includeSplash: true,
		});
		const modifiers = p.getDisplayedModifiers();
		const tinctureBonus = modifiers.some((m) => m.source === PotencyModifierType.POT)
			? this.#tinctureBonus
			: 0;
		if (p.sourceSkill === "ATTACK") {
			// The engine's auto-attack base is already skill-speed scaled; rebuild it from the
			// unscaled potency so that speed is applied inside the floored chain.
			const base = model.baseDamage(
				this.game.jobSpecificAutoBasePotency(),
				"auto",
				tinctureBonus,
			);
			return base * model.expectedCritDhMulti() * (engineAmount / p.base);
		}
		// Combo and positional bonuses are additive modifiers that form the hit's actual potency.
		// DoT tick potencies are already speed scaled by the engine, so they go through as "direct".
		const potency =
			p.base +
			modifiers.reduce((sum, m) => sum + (m.kind === "adder" ? m.additiveAmount : 0), 0);
		const base = model.baseDamage(potency, "direct", tinctureBonus);
		return base * model.expectedCritDhMulti() * (engineAmount / potency);
	}

	// Same applied/pending split as ActionNode.getPotency, for expected damage.
	#nodeDamage(model: DamageModel, node: ActionNode) {
		const res = { applied: 0, pending: 0 };
		const potencies = [
			node.getInitialPotency(),
			...[...node.getAllDotPotencies().values()].flat(),
		];
		for (const p of potencies) {
			if (p === undefined) continue;
			if (p.hasHitBoss(this.#untargetable)) {
				res.applied += this.#expectedDamage(model, p);
			} else if (!p.hasResolved() && p.hasSnapshotted()) {
				res.pending += this.#expectedDamage(model, p);
			}
		}
		return res;
	}

	#damageTotals(model: DamageModel, nodes: ActionNode[]): DamageTotals {
		const totals: DamageTotals = { expectedDamage: 0, autoAttackDamage: 0, pendingDamage: 0 };
		for (const node of nodes) {
			const damage = this.#nodeDamage(model, node);
			totals.expectedDamage += damage.applied;
			totals.pendingDamage += damage.pending;
			if (node.maybeGetActionKey() === "ATTACK") {
				totals.autoAttackDamage += damage.applied;
			}
		}
		const endTime = this.game.getDisplayTime();
		if (endTime > 0) {
			totals.expectedDps = totals.expectedDamage / endTime;
		}
		return totals;
	}

	result(id: string): RotationResult {
		const model = this.damageModel;
		const actions: SimulatedAction[] = this.#executed.map((e) => {
			const potency = this.#nodePotency(e.node);
			const damage = model ? this.#nodeDamage(model, e.node) : undefined;
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
				expectedDamage: damage?.applied,
				pendingDamage: damage?.pending,
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
				// Upstream's "without pot" total also excludes party buffs.
				appliedPotencyWithoutPot += this.#nodePotency(node, 1, false).applied;
			}
			if (node.maybeGetActionKey() === "ATTACK") {
				autoAttackPotency += potency.applied;
			}
		}
		const gcdCount = this.#executed.filter(
			(e) => e.isGCD && e.node.hitBoss(this.#untargetable),
		).length;

		const damageEvents: DamageEvent[] = this.host.resolvedPotencies.map((p) => ({
			time: p.applicationTime!,
			source: p.sourceSkill,
			potency: p.getAmount({
				tincturePotencyMultiplier: this.#tincturePotencyMultiplier,
				includePartyBuffs: true,
				includeSplash: true,
			}),
			expectedDamage: model ? this.#expectedDamage(model, p) : undefined,
			isAutoAttack: p.sourceSkill === "ATTACK",
			hitTarget: p.hasHitBoss(this.#untargetable),
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
			damage: model ? this.#damageTotals(model, allNodes) : undefined,
			encounter: {
				partyBuffs: this.#encounter.partyBuffs.map((w) => ({ ...w })),
				downtime: this.#encounter.downtime.map((w) => ({ ...w })),
			},
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
