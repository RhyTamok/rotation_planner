import { describe, expect, it } from "vitest";

import { rotationTestSetup, rotationTestTeardown, makeTestWithConfigFn, applySkill } from "./utils";
import { controller } from "../Controller/Controller";
import { ActionType } from "../Controller/Record";
import { ElemType, MarkerType, UntargetableMarkerTrack } from "../Controller/Timeline";
import { MarkerColor } from "../Components/ColorTheme";
import { BuffType } from "../Game/Common";
import { DEFAULT_CONFIG } from "../Game/GameConfig";
import { ActionKey } from "../Game/Data";
import { cumulativeSeries, dpsAt, totalAt } from "../RotationLab/comparison/compare";
import { RotationSimulator, simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import {
	DowntimeWindow,
	PartyBuffWindow,
	RotationResult,
	SimulationEnd,
} from "../RotationLab/simulation/types";

beforeEach(rotationTestSetup);
afterEach(() => {
	controller.timeline.deleteAllMarkers();
	rotationTestTeardown();
});

const testWithConfig = makeTestWithConfigFn("VPR");

// The countdown is 5s, so the first action is at display time -5 and GCDs follow ~2.5s apart.
const FILLER: ActionKey[] = Array(10).fill("STEEL_FANGS");
const BUFFS: Required<PartyBuffWindow>[] = [
	// Damage multiplier.
	{ buff: BuffType.TechnicalFinish, time: 0, duration: 20 },
	// Crit chance buff.
	{ buff: BuffType.BattleLitany, time: 4, duration: 20 },
];
const DOWNTIME: DowntimeWindow[] = [{ start: 6, end: 11 }];

describe("Rotation Lab - encounter parity with the XIV in the Shell controller", () => {
	it(
		"matches per-action potency, damage masking and auto-attacks under buffs and downtime",
		testWithConfig({}, () => {
			// Controller side: the same windows as timeline markers.
			controller.timeline.addBuffMarkers(
				BUFFS.map((w) => ({ buffType: w.buff, time: w.time, duration: w.duration })),
			);
			for (const w of DOWNTIME) {
				controller.timeline.addMarker({
					type: ElemType.Marker,
					markerType: MarkerType.Untargetable,
					time: w.start,
					duration: w.end - w.start,
					color: MarkerColor.Grey,
					track: UntargetableMarkerTrack,
					showText: true,
					description: "",
				});
			}
			FILLER.forEach(applySkill);
			controller.step(4);

			const untargetable = (t: number) => controller.timeline.duringUntargetable(t);
			const countdown = controller.game.config.countdown;
			const controllerActions = controller.record.actions
				.filter((node) => node.info.type === ActionType.Skill)
				.map((node) => ({
					executedAction: node.maybeGetActionKey(),
					startTime: node.tmp_startLockTime! - countdown,
					appliedPotency: node.getPotency({
						tincturePotencyMultiplier: 1,
						untargetable,
						includePartyBuffs: true,
						includeSplash: true,
					}).applied,
				}));
			const controllerAutoTimes = controller.game.fakeAutoActionNodes.map(
				(n) => n.getInitialPotency()!.snapshotTime,
			);

			// Simulator side.
			const sim = new RotationSimulator("VPR", {
				config: { ...DEFAULT_CONFIG, job: "VPR" },
				partyBuffs: BUFFS,
				downtime: DOWNTIME,
			});
			FILLER.forEach((s) => sim.step(s));
			sim.step({ type: "wait", seconds: 4 });
			const result = sim.result("parity");
			const simAutoTimes = sim.game.fakeAutoActionNodes.map(
				(n) => n.getInitialPotency()!.snapshotTime,
			);

			// The scenario must actually exercise buffs and downtime.
			expect(result.damageEvents.some((e) => !e.hitTarget)).toBe(true);
			expect(controllerActions.some((a) => a.appliedPotency === 0)).toBe(true);

			expect(result.actions).toHaveLength(controllerActions.length);
			result.actions.forEach((actual, i) => {
				const expected = controllerActions[i];
				expect(actual.executedAction, `action ${i}`).toBe(expected.executedAction);
				expect(actual.startTime, `action ${i} start`).toBeCloseTo(expected.startTime, 6);
				expect(actual.appliedPotency, `action ${i} potency`).toBeCloseTo(
					expected.appliedPotency,
					6,
				);
			});
			expect(simAutoTimes).toHaveLength(controllerAutoTimes.length);
			simAutoTimes.forEach((t, i) => expect(t).toBeCloseTo(controllerAutoTimes[i]!, 6));
		}),
	);
});

describe("Rotation Lab - party buffs and downtime", () => {
	const single = { id: "single", steps: ["STEEL_FANGS"] as ActionKey[] };

	it("applies a damage multiplier buff to hits that snapshot inside it", () => {
		const plain = simulateRotation(single, { end: "settled" });
		const buffed = simulateRotation(single, {
			end: "settled",
			partyBuffs: [{ buff: BuffType.TechnicalFinish, time: -10 }],
		});

		expect(buffed.encounter.partyBuffs).toEqual([
			{ buff: BuffType.TechnicalFinish, time: -10, duration: 20 },
		]);
		expect(buffed.actions[0].appliedPotency).toBeCloseTo(
			plain.actions[0].appliedPotency * 1.05,
			6,
		);
		expect(buffed.actions[0].expectedDamage).toBeCloseTo(
			plain.actions[0].expectedDamage! * 1.05,
			6,
		);
	});

	it("applies a crit buff through the expected crit multiplier", () => {
		const plain = simulateRotation(single, { end: "settled" });
		const sim = new RotationSimulator("VPR", {
			partyBuffs: [{ buff: BuffType.BattleLitany, time: -10 }],
		});
		sim.step("STEEL_FANGS");
		sim.finish("settled");
		const buffed = sim.result("litany").actions[0];

		// Battle Litany: +10% crit chance.
		const model = sim.damageModel!;
		const withLitany =
			(1 + model.directHitChance() * 0.25) *
			(1 + (model.critChance() + 0.1) * (model.critMulti() - 1));
		expect(buffed.expectedDamage).toBeCloseTo(
			(plain.actions[0].expectedDamage! * withLitany) / model.expectedCritDhMulti(),
			6,
		);
	});

	it("ignores buff windows that do not cover the snapshot", () => {
		const plain = simulateRotation(single, { end: "settled" });
		const late = simulateRotation(single, {
			end: "settled",
			partyBuffs: [{ buff: BuffType.TechnicalFinish, time: 30 }],
		});

		expect(late.actions[0].expectedDamage).toBeCloseTo(plain.actions[0].expectedDamage!, 6);
	});

	it("drops damage landing in downtime and pauses auto-attacks", () => {
		const downtime = [{ start: 6, end: 16 }];
		const result = simulateRotation({ id: "downtime", steps: FILLER }, { end: 25, downtime });
		const inside = (t: number) => t >= 6 && t < 16;

		const missed = result.damageEvents.filter((e) => !e.hitTarget);
		expect(missed.length).toBeGreaterThan(0);
		expect(missed.every((e) => inside(e.time))).toBe(true);
		expect(result.damageEvents.filter((e) => e.hitTarget).every((e) => !inside(e.time))).toBe(
			true,
		);
		// No auto-attack lands inside the window.
		expect(result.damageEvents.some((e) => e.isAutoAttack && inside(e.time))).toBe(false);

		const counted = result.damageEvents
			.filter((e) => e.hitTarget)
			.reduce((sum, e) => sum + e.expectedDamage!, 0);
		expect(result.damage!.expectedDamage).toBeCloseTo(counted, 6);
		expect(result.encounter.downtime).toEqual(downtime);
	});

	it("keeps encounter conditions isolated between simulations and from the controller", () => {
		const buffMarkersBefore = controller.timeline.getBuffMarkers().length;
		const plainA = simulateRotation(single, { end: "settled" });
		simulateRotation(single, {
			end: "settled",
			partyBuffs: [{ buff: BuffType.TechnicalFinish, time: -10 }],
			downtime: [{ start: -4.9, end: 30 }],
		});
		const plainB = simulateRotation(single, { end: "settled" });

		expect(plainB).toEqual(plainA);
		expect(controller.timeline.getBuffMarkers()).toHaveLength(buffMarkersBefore);
		expect(controller.timeline.duringUntargetable(0)).toBe(false);
	});

	it("rejects downtime windows that do not end after they start", () => {
		expect(() => new RotationSimulator("VPR", { downtime: [{ start: 5, end: 5 }] })).toThrow();
	});
});

// Comparison milestone M0: how a cutoff reads a real simulation's downtime and end mode (spec 2.2).
describe("Rotation Lab - cutoffs against downtime and end modes", () => {
	const run = (
		options: { end?: SimulationEnd; downtime?: DowntimeWindow[] } = {},
		steps: ActionKey[] = FILLER,
	) =>
		simulateRotation(
			{ id: "cutoffs", steps },
			{ encounterRules: true, config: { fps: 0 }, end: "settled", ...options },
		);
	const actionHits = (result: RotationResult) =>
		result.damageEvents.filter((e) => !e.isAutoAttack);
	const damageSeries = (result: RotationResult) => cumulativeSeries(result, "damage");
	// When the 4th hit lands without downtime. It is pressed over 1 s earlier, so the windows
	// below start after that press: it stays valid and lands at the same time.
	const fourthHitTime = () => actionHits(run())[3].time;

	it("counts a hit landing in downtime as 0, though its event still carries an amount", () => {
		const t = fourthHitTime();
		const result = run({ downtime: [{ start: t, end: t + 1 }] });
		const ghosted = actionHits(result)[3];
		const series = damageSeries(result);

		// Landing exactly at the window's start is inside it.
		expect(ghosted.time).toBe(t);
		expect(ghosted.hitTarget).toBe(false);
		// Readers must go through hitTarget (as cumulativeSeries does), not sum the raw amounts.
		expect(ghosted.expectedDamage).toBeGreaterThan(0);
		expect(totalAt(series, t)).toBeCloseTo(totalAt(series, t - 0.001), 6);
		expect(totalAt(series, result.endTime)).toBeCloseTo(result.damage!.expectedDamage, 6);
	});

	it("counts a hit landing exactly when downtime ends", () => {
		const t = fourthHitTime();
		const result = run({ downtime: [{ start: t - 1, end: t }] });
		const hit = actionHits(result)[3];
		const series = damageSeries(result);

		expect(hit.time).toBe(t);
		expect(hit.hitTarget).toBe(true);
		expect(totalAt(series, t) - totalAt(series, t - 0.001)).toBeCloseTo(hit.expectedDamage!, 6);
	});

	it("divides a cutoff inside downtime by the full time since the pull", () => {
		const result = run({ downtime: [{ start: 6, end: 16 }] });
		const series = damageSeries(result);

		// Presses inside the window are rejected as invalid, so they produce no hit at all.
		expect(result.actions.some((a) => !a.valid)).toBe(true);
		expect(actionHits(result).some((e) => e.time >= 6 && e.time < 16)).toBe(false);
		// Nothing lands on the boss during the window, so the total is flat and DPS keeps falling.
		const total = totalAt(series, 6);
		expect(total).toBeGreaterThan(0);
		expect(totalAt(series, 15.999)).toBe(total);
		expect(dpsAt(series, 8)).toBeCloseTo(total / 8, 6);
		expect(dpsAt(series, 12)).toBeCloseTo(total / 12, 6);
	});

	it("leaves a hit still in flight out of a lastAction result but not a settled one", () => {
		const lastAction = run({ end: "lastAction" });
		const settled = run({ end: "settled" });
		const flight = actionHits(settled).at(-1)!;

		expect(lastAction.endTime).toBeLessThan(flight.time);
		expect(lastAction.damage!.pendingDamage).toBeCloseTo(flight.expectedDamage!, 6);
		expect(actionHits(lastAction)).toHaveLength(actionHits(settled).length - 1);
		expect(settled.damage!.pendingDamage).toBe(0);

		// Same totals up to where lastAction stopped; after it, only settled has the hit.
		const a = damageSeries(lastAction);
		const b = damageSeries(settled);
		expect(totalAt(a, lastAction.endTime)).toBeCloseTo(totalAt(b, lastAction.endTime), 6);
		expect(totalAt(b, flight.time) - totalAt(a, flight.time)).toBeCloseTo(
			flight.expectedDamage!,
			6,
		);
	});

	it("reads the same total from a settled run as a run stopped at that cutoff", () => {
		const settled = run();
		const flight = actionHits(settled)[3];
		const cutoff = flight.time - 0.001;
		const stopped = run({ end: cutoff }, FILLER.slice(0, 4));

		expect(stopped.endTime).toBeCloseTo(cutoff, 6);
		expect(stopped.damage!.pendingDamage).toBeCloseTo(flight.expectedDamage!, 6);
		expect(stopped.damage!.expectedDamage).toBeCloseTo(
			totalAt(damageSeries(settled), cutoff),
			6,
		);
	});
});
