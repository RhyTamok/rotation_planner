import { describe, expect, it } from "vitest";

import { LevelSync } from "../Game/Common";
import { makeDefaultConfig } from "../Game/GameConfig";
import { DamageModel, fl } from "../RotationLab/damage/DamageModel";
import { RotationSimulator, simulateRotation } from "../RotationLab/simulation/RotationSimulator";

// Viper's default level 100 config: main 5925, WD 152, party bonus 5%, crit 3378, DH 1981,
// det 2370, sks 420, tenacity 420. Expected values below were computed by hand from xivgear's
// formulas (see DamageModel.ts) and are not derived from this implementation.
function defaultViperModel(weaponDelay = 2.64) {
	const config = makeDefaultConfig("VPR");
	return new DamageModel("VPR", {
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

describe("Rotation Lab - damage model formulas", () => {
	const model = defaultViperModel();

	it("floors with floating-point tolerance", () => {
		expect(fl(2.3 * 100)).toBe(230);
		expect(fl(7049.322)).toBe(7049);
	});

	it("computes stat multipliers at level 100", () => {
		expect(model.mainStat).toBe(6221);
		expect(model.mainStatMulti(model.mainStat)).toBeCloseTo(32.13, 10);
		expect(model.wdMulti()).toBeCloseTo(2.0, 10);
		expect(model.autoAttackMulti()).toBeCloseTo(1.76, 10);
		expect(model.detMulti()).toBeCloseTo(1.097, 10);
		expect(model.tenacityMulti()).toBeCloseTo(1, 10);
		expect(model.skillSpeedMulti()).toBeCloseTo(1, 10);
		expect(model.critChance()).toBeCloseTo(0.262, 10);
		expect(model.critMulti()).toBeCloseTo(1.612, 10);
		expect(model.directHitChance()).toBeCloseTo(0.308, 10);
		expect(model.expectedCritDhMulti()).toBeCloseTo(1.077 * (1 + 0.262 * 0.612), 10);
	});

	it("applies the floored damage chain", () => {
		expect(model.baseDamage(200, "direct")).toBe(14098);
		// Auto-attacks use the auto-attack multiplier and gain +1 for potency below 100.
		expect(model.baseDamage(90, "auto")).toBe(5581);
	});

	it("models a gemdraught as a capped main stat bonus", () => {
		expect(model.tinctureBonus(4)).toBe(541);
		expect(model.tinctureBonus(1)).toBe(351);
		expect(model.mainStatMulti(model.mainStat + 541)).toBeCloseTo(35.05, 10);
		expect(model.baseDamage(200, "direct", 541)).toBe(15378);
	});

	it("uses weapon delay for the auto-attack multiplier", () => {
		expect(defaultViperModel(3).autoAttackMulti()).toBeCloseTo(2.0, 10);
	});

	it("rejects levels without verified constants", () => {
		const config = makeDefaultConfig("VPR");
		expect(
			() =>
				new DamageModel("VPR", {
					...config,
					level: LevelSync.lvl70,
					weaponDelay: 2.64,
				}),
		).toThrow();
	});
});

describe("Rotation Lab - expected damage in simulations", () => {
	const model = defaultViperModel();
	const critDh = model.expectedCritDhMulti();

	it("reports expected damage for an unbuffed hit", () => {
		const result = simulateRotation({ id: "one", steps: ["STEEL_FANGS"] }, { end: "settled" });
		const [action] = result.actions;

		expect(action.appliedPotency).toBeGreaterThan(0);
		expect(action.expectedDamage).toBeCloseTo(
			model.baseDamage(action.appliedPotency, "direct") * critDh,
			6,
		);
		expect(action.pendingDamage).toBe(0);
	});

	it("applies the tincture to hits that snapshot under it, not to others", () => {
		const potted = simulateRotation(
			{ id: "pot", steps: ["TINCTURE", "STEEL_FANGS"] },
			{ end: "settled" },
		);
		const unpotted = simulateRotation(
			{ id: "no-pot", steps: ["STEEL_FANGS"] },
			{ end: "settled" },
		);
		const pottedHit = potted.actions.find((a) => a.executedAction === "STEEL_FANGS")!;
		const plainHit = unpotted.actions[0];

		expect(pottedHit.appliedPotency).toBe(plainHit.appliedPotency);
		expect(pottedHit.expectedDamage).toBeCloseTo(
			model.baseDamage(pottedHit.appliedPotency, "direct", 541) * critDh,
			6,
		);
		expect(plainHit.expectedDamage).toBeCloseTo(
			model.baseDamage(plainHit.appliedPotency, "direct") * critDh,
			6,
		);
	});

	it("computes auto-attack damage from the unscaled auto potency", () => {
		const result = simulateRotation({ id: "autos", steps: ["STEEL_FANGS"] }, { end: 5 });
		const autos = result.damageEvents.filter((e) => e.isAutoAttack);

		expect(autos.length).toBeGreaterThan(0);
		// The first auto lands before any damage buff is up.
		expect(autos[0].expectedDamage).toBeCloseTo(5581 * critDh, 6);
		expect(result.damage!.autoAttackDamage).toBeCloseTo(
			autos.reduce((sum, e) => sum + e.expectedDamage!, 0),
			6,
		);
	});

	it("uses weapon delay for auto-attack timing and damage", () => {
		const steps = Array(12).fill("STEEL_FANGS");
		const fast = simulateRotation({ id: "fast", steps }, { end: 30 });
		const slow = simulateRotation({ id: "slow", steps }, { end: 30, weaponDelay: 3.5 });
		const autoCount = (r: typeof fast) => r.damageEvents.filter((e) => e.isAutoAttack).length;

		expect(autoCount(slow)).toBeLessThan(autoCount(fast));
		// Same GCD sequence, so only auto-attacks differ.
		expect(slow.totals.appliedPotency - slow.totals.autoAttackPotency).toBeCloseTo(
			fast.totals.appliedPotency - fast.totals.autoAttackPotency,
			6,
		);
	});

	it("sums totals consistently and reports DPS against the cutoff", () => {
		const result = simulateRotation(
			{ id: "dps", steps: Array(8).fill("STEEL_FANGS") },
			{ end: 20 },
		);
		const damage = result.damage!;
		const fromEvents = result.damageEvents.reduce((sum, e) => sum + e.expectedDamage!, 0);

		expect(damage.expectedDamage).toBeCloseTo(fromEvents, 6);
		expect(damage.expectedDps).toBeCloseTo(damage.expectedDamage / 20, 6);
	});

	it("leaves potency results unchanged when stats change", () => {
		const steps = ["STEEL_FANGS", "STEEL_FANGS", "STEEL_FANGS"] as const;
		const base = simulateRotation({ id: "base", steps: [...steps] }, { end: 15 });
		const stronger = simulateRotation(
			{ id: "stronger", steps: [...steps] },
			{ end: 15, config: { main: 6500, wd: 160 } },
		);

		expect(stronger.totals).toEqual(base.totals);
		expect(stronger.damage!.expectedDamage).toBeGreaterThan(base.damage!.expectedDamage);
	});

	it("omits damage when no verified constants exist for the job", () => {
		const sim = new RotationSimulator("DRG");
		sim.step("TRUE_THRUST");
		const result = sim.result("drg");

		expect(sim.damageModel).toBeUndefined();
		expect(result.damage).toBeUndefined();
		expect(result.actions[0].expectedDamage).toBeUndefined();
		expect(result.totals.appliedPotency).toBeGreaterThanOrEqual(0);
	});
});
