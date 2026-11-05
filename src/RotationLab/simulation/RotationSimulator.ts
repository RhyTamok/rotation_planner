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
import { EncounterViolation, isDamaging, needsTarget } from "../rules/encounterRules";
import {
	brokenCombos,
	comboSteps,
	ResourceSnapshot,
	snapshotResources,
} from "../rules/resourceTracking";
import { effectiveRanges, targetListFor } from "../rules/targets";
import { RecordingHost } from "./RecordingHost";
import {
	DamageEvent,
	DamageTotals,
	TargetRange,
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

// Below this, time differences are floating-point noise.
const TIME_EPSILON = 1e-6;

interface ExecutedSkill {
	stepIndex: number;
	requestedAction: ActionKey;
	executedAction: ActionKey;
	node: ActionNode;
	startTime: number;
	lockEndTime: number;
	isGCD: boolean;
	ruleViolations: string[];
	comboBreaks: string[];
	pullHold?: number;
	// GCDs only: display time at which the next GCD becomes ready.
	nextGcdReadyTime?: number;
	resources: ResourceSnapshot;
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
	readonly #encounterRules: boolean;
	readonly #targets: TargetRange[];
	#executed: ExecutedSkill[] = [];
	#errors: StepError[] = [];
	#stepCount = 0;
	// With encounter rules: display time at which the first damaging action landed (the pull).
	#pullTime?: number;

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
		this.#encounterRules = options.encounterRules ?? false;
		this.#targets = effectiveRanges(options.targets ?? []);

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

	// With encounter rules: when the first damaging action landed, if one has been used.
	get pullTime(): number | undefined {
		return this.#pullTime;
	}

	step(step: ActionKey | RotationStep) {
		const stepIndex = this.#stepCount++;
		const normalized: RotationStep =
			typeof step === "string" ? { type: "skill", action: step } : step;
		if (normalized.type === "skill") {
			// A step's own `targets` (from upstream imports) is ignored on purpose: the rotation's
			// target ranges are the only source of truth in the Lab.
			this.#useSkill(stepIndex, normalized.action, normalized.delay ?? 0);
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
	// `delay` counts from when the action first becomes usable (normally the end of the previous
	// animation lock), so it always moves the action later.
	// Without explicit `targets`, the step hits the enemies present from the press to the damage
	// application (rules/targets.ts); the engine then cuts single-target skills down to one.
	#useSkill(stepIndex: number, requestedAction: ActionKey, delay: number) {
		let status = this.game.getSkillAvailabilityStatus(requestedAction);
		this.#tick(status.timeTillAvailable + delay);

		let executedAction = getConditionalReplacement(requestedAction, this.game);
		status = this.game.getSkillAvailabilityStatus(executedAction);

		let pullHold: number | undefined;
		let landsAtPull = false;
		if (
			this.#encounterRules &&
			this.#pullTime === undefined &&
			status.status.ready() &&
			isDamaging(this.game, executedAction)
		) {
			landsAtPull = true;
			const landing = this.game.getDisplayTime() + status.timeTillDamageApplication;
			if (landing < -TIME_EPSILON) {
				pullHold = -landing;
				this.#tick(pullHold);
				executedAction = getConditionalReplacement(requestedAction, this.game);
				status = this.game.getSkillAvailabilityStatus(executedAction);
			}
		}

		const ruleViolations: string[] = [];
		if (
			this.#encounterRules &&
			this.#untargetable(this.game.getDisplayTime()) &&
			needsTarget(this.game, executedAction)
		) {
			ruleViolations.push(EncounterViolation.NoTarget);
			landsAtPull = false;
		}

		const press = this.game.getDisplayTime();
		const targetList = targetListFor(
			this.#targets,
			press,
			press + (status.status.ready() ? status.timeTillDamageApplication : 0),
		);
		const node = skillNode(executedAction, this.#filterTargetList(targetList, executedAction));
		const actionIndex = this.#executed.length;

		node.tmp_startLockTime = this.game.time;
		let comboBreaks: string[] = [];
		if (status.status.ready() && ruleViolations.length === 0) {
			const combosBefore = comboSteps(this.game);
			this.game.useSkill(executedAction, node, actionIndex);
			comboBreaks = brokenCombos(this.game, combosBefore, executedAction);
			node.tmp_invalid_reasons = [];
			if (landsAtPull) {
				this.#pullTime = this.game.getDisplayTime() + status.timeTillDamageApplication;
			}
		} else {
			this.game.useInvalidSkill(executedAction, node);
			node.tmp_invalid_reasons = status.status.unavailableReasons;
		}
		const lockDuration = this.game.timeTillAnySkillAvailable();
		node.tmp_startLockTime = this.game.time;
		node.tmp_endLockTime = this.game.time + lockDuration;

		const isGCD = this.game.skillsList.get(executedAction).cdName === "cd_GCD";
		const startTime = this.game.getDisplayTime();
		const executed: ExecutedSkill = {
			stepIndex,
			requestedAction,
			executedAction,
			node,
			startTime,
			lockEndTime: startTime + lockDuration,
			isGCD,
			ruleViolations,
			comboBreaks,
			pullHold,
			nextGcdReadyTime: isGCD
				? startTime + this.game.cooldowns.get("cd_GCD").timeTillNextStackAvailable()
				: undefined,
			resources: { gauges: [], timers: [] },
		};
		this.#executed.push(executed);

		// Manual mode fast-forwards to the end of the animation lock.
		this.#tick(lockDuration);
		executed.resources = snapshotResources(this.game);
	}

	// How late each GCD was pressed relative to the previous GCD's recast, and whether the oGCD
	// right before it caused that by holding the animation lock past the GCD becoming ready.
	#gcdDelays(): Map<ExecutedSkill, { gcdDelay: number; clipped: boolean }> {
		const delays = new Map<ExecutedSkill, { gcdDelay: number; clipped: boolean }>();
		let lastGcd: ExecutedSkill | undefined;
		this.#executed.forEach((e, i) => {
			if (!e.isGCD) return;
			if (lastGcd?.nextGcdReadyTime !== undefined) {
				const gcdDelay = e.startTime - lastGcd.nextGcdReadyTime;
				if (gcdDelay > TIME_EPSILON) {
					const previous = this.#executed[i - 1];
					const clipped =
						!previous.isGCD &&
						Math.abs(e.startTime - previous.lockEndTime) < TIME_EPSILON &&
						(e.pullHold ?? 0) === 0;
					delays.set(e, { gcdDelay, clipped });
				}
			}
			lastGcd = e;
		});
		return delays;
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

	// Seconds between the start of the downtime window containing `displayTime` and that time.
	#timeIntoDowntime(displayTime: number): number {
		const window = this.#encounter.downtime.find(
			(w) => displayTime >= w.start && displayTime < w.end,
		);
		return window ? displayTime - window.start : 0;
	}

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
			bossDebuffsOnPrimaryOnly: true,
		});
	}

	// Expected damage of one hit. The engine's potency amount is the base potency scaled by buffs
	// relative to the unbuffed crit/DH expectation; that ratio is applied on top of the floored
	// damage chain, followed by the character's own crit/DH expectation.
	#expectedDamage(model: DamageModel, p: Potency): number {
		if (p.base === 0) {
			return 0;
		}
		// Includes the AoE falloff for every enemy hit (Potency.#getAmountWithModifiers).
		const engineAmount = p.getAmount({
			tincturePotencyMultiplier: 1,
			includePartyBuffs: true,
			includeSplash: true,
			bossDebuffsOnPrimaryOnly: true,
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
		const gcdDelays = this.#gcdDelays();
		const actions: SimulatedAction[] = this.#executed.map((e) => {
			const potency = this.#nodePotency(e.node);
			const damage = model ? this.#nodeDamage(model, e.node) : undefined;
			const invalidReasons: string[] = [...e.node.tmp_invalid_reasons, ...e.ruleViolations];
			const hit = e.node.getInitialPotency();
			const ghostedBy =
				invalidReasons.length === 0 &&
				hit !== undefined &&
				hit.base > 0 &&
				hit.hasResolved() &&
				!hit.hasHitBoss(this.#untargetable)
					? this.#timeIntoDowntime(hit.applicationTime!)
					: undefined;
			return {
				stepIndex: e.stepIndex,
				requestedAction: e.requestedAction,
				executedAction: e.executedAction,
				startTime: e.startTime,
				lockEndTime: e.lockEndTime,
				isGCD: e.isGCD,
				valid: invalidReasons.length === 0,
				invalidReasons,
				pullHold: e.pullHold,
				gcdDelay: gcdDelays.get(e)?.gcdDelay,
				clipped: gcdDelays.get(e)?.clipped,
				ghostedBy,
				comboBreaks: e.comboBreaks.length > 0 ? [...e.comboBreaks] : undefined,
				resources: e.resources,
				appliedPotency: potency.applied,
				pendingPotency: potency.snapshottedButPending,
				expectedDamage: damage?.applied,
				pendingDamage: damage?.pending,
				// A hit ghosted in downtime struck nobody.
				targetsHit:
					hit !== undefined && hit.base > 0 && ghostedBy === undefined
						? hit.targetCount
						: 0,
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
				bossDebuffsOnPrimaryOnly: true,
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
	const run = (runOptions: SimulationOptions) => {
		const simulator = new RotationSimulator(job, runOptions);
		input.steps.forEach((step) => simulator.step(step));
		simulator.finish(runOptions.end);
		return simulator;
	};
	const simulator = run(options);
	const late = simulator.pullTime ?? 0;
	if (!options.encounterRules || late <= TIME_EPSILON) {
		return simulator.result(input.id);
	}
	// The first hit defines 0 s. It landed late, so the pull happened earlier than the countdown
	// assumed: lengthen the countdown so the same inputs put the first hit exactly at 0 s.
	const countdown = options.config?.countdown ?? makeDefaultConfig(job).countdown;
	const result = run({
		...options,
		config: { ...options.config, countdown: countdown + late },
	}).result(input.id);
	return { ...result, countdownExtension: late };
}
