import { describe, expect, it } from "vitest";

import { LevelSync } from "../Game/Common";
import { DamageModel } from "../RotationLab/damage/DamageModel";

// Cross-check against reference/VPR 7.2 DT Planner v2.22.xlsx, "Planner (with sample)".
// Inputs from the sheet: main 4861 (BI3), crit 3173 (BK3), det 2387 (BK5), SkS 420 (BM3),
// weapon delay 2.56 (BI5), party bonus 5%. The sheet was built from a Ninja template, hence
// Ninja's 2.56 delay; Viper's real delay is 2.64 (the simulator default). 2.56 is used here only
// to reproduce the sheet's numbers. WD 146 and DH 28.1% are recovered from CN31 and CN17;
// any DH stat in 1841-1845 gives the sheet's 28.1%.
// Expected damage values are the sheet's column AL (per-hit damage).
//
// The sheet truncates potency * fAP * fDET in one step and floors the expected crit multiplier to
// three decimals, truncating after crit, DH and each buff. xivgear (and DamageModel) floor after
// each of fAP and fDET and apply crit/DH and buffs unfloored, so totals land slightly above the
// sheet. The intermediate values that both orders share are checked exactly.
const model = new DamageModel("VPR", {
	level: LevelSync.lvl100,
	main: 4861,
	wd: 146,
	weaponDelay: 2.56,
	partyBonus: 5,
	criticalHit: 3173,
	directHit: 1843,
	determination: 2387,
	skillSpeed: 420,
	tenacity: 420,
});
const HUNTERS_INSTINCT = 1.1;
// The two rounding orders differ by well under 0.1% per hit.
const TOLERANCE = 0.001;

function expectWithinTolerance(actual: number, sheet: number) {
	expect(Math.abs(actual - sheet) / sheet).toBeLessThan(TOLERANCE);
}

describe("Rotation Lab - 7.2 workbook cross-check", () => {
	it("matches the sheet's stat multipliers", () => {
		expect(model.mainStatMulti(model.mainStat)).toBeCloseTo(26.12, 10); // AS = 2612
		expect(model.detMulti()).toBeCloseTo(1.098, 10); // CN19 = 1098
		expect(model.wdMulti()).toBeCloseTo(1.94, 10); // jobmod 110; the sheet's AL uses 194
		expect(model.autoAttackMulti()).toBeCloseTo(1.65, 10);
		expect(model.critChance()).toBeCloseTo(0.248, 10);
		expect(model.critMulti()).toBeCloseTo(1.598, 10);
		expect(model.directHitChance()).toBeCloseTo(0.281, 10); // CN17 = 28.1
	});

	it("matches the sheet's pre-crit damage where rounding orders agree", () => {
		expect(model.baseDamage(300, "direct")).toBe(16689);
		expect(model.baseDamage(320, "direct")).toBe(17803);
		expect(model.baseDamage(90, "auto")).toBe(4258);
	});

	it("stays within 0.1% of the sheet's expected damage per hit", () => {
		const critDh = model.expectedCritDhMulti();
		// AL13: potency 300, unbuffed.
		expectWithinTolerance(model.baseDamage(300, "direct") * critDh, 20503);
		// AL185: potency 320 under Hunter's Instinct.
		expectWithinTolerance(model.baseDamage(320, "direct") * critDh * HUNTERS_INSTINCT, 24059);
		// AL181: potency 680 under Hunter's Instinct. Pre-crit values differ by rounding order
		// (sheet 37833, xivgear order 37831).
		expectWithinTolerance(model.baseDamage(680, "direct") * critDh * HUNTERS_INSTINCT, 51131);
		// AN187 - AL187: auto-attack under Hunter's Instinct.
		expectWithinTolerance(model.baseDamage(90, "auto") * critDh * HUNTERS_INSTINCT, 5754);
	});
});
