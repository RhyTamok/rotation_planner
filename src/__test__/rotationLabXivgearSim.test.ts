import { describe, expect, it } from "vitest";

import { ActionKey } from "../Game/Data";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationResult } from "../RotationLab/simulation/types";
import fixture from "./Asset/xivgear/vpr_100_crosscheck.json";

// Cross-check against an independent tool (roadmap 1.6): xivgear's own Viper sim, run from a local
// clone by tools/xivgear-crosscheck, wrote the fixture. This test replays the very same action list
// on the same stats in the Lab and compares the expected damage of every action.
//
// Tolerance: 1e-6 relative per action (the fixture is rounded to 3 decimals). Everything that does
// not agree is listed here and pinned by a test of its own. Do not widen the tolerance or edit the
// fixture by hand to make a failure go away: find out which side changed, and why.
//
// Known differences, all on xivgear's side of the modelling:
// 1. Twinfang/Twinblood Bite and Uncoiled Twinfang/Twinblood: xivgear always uses the base potency
//    of 120. The Lab adds the +50 of the venom buff the preceding action grants (170).
// 2. Combo finishers: xivgear names finishers the game does not offer after that second step (a
//    rear finisher after Hunter's Sting, a flank one after Swiftskin's Sting). Its damage is not
//    affected, since all four share one potency. The Lab's engine swaps in the finisher the button
//    would really show, which then lacks the matching venom. `legalSteps` therefore replays the
//    list with the finisher that is legal there and consumes the current venom.
// 3. Timing: xivgear gives Ouroboros a 2.0 s recast (1.70 s hasted), the engine 3.0 s (2.55 s).
//    xivgear's animation lock is 0.6 s, the engine's 0.7 s. Times and DPS are therefore not
//    compared, only what each action and each auto-attack hits for.
const TOLERANCE = 1e-6;

interface XivgearRecord {
	time: number;
	name: string;
	type: string;
	potency: number;
	damage: number;
	buffs: string[];
	partial?: number;
}

const records: XivgearRecord[] = fixture.records;
const skills = records.filter((r) => r.type !== "autoattack" && r.partial === undefined);
const autos = records.filter((r) => r.type === "autoattack");

const keyOf = (name: string) =>
	name.toUpperCase().replace(/'/g, "").replace(/ /g, "_") as ActionKey;

const VENOM_BITES = ["TWINFANG_BITE", "TWINBLOOD_BITE", "UNCOILED_TWINFANG", "UNCOILED_TWINBLOOD"];

// finisher -> [position, venom it consumes, venom it grants] (Game/Jobs/VPR.ts `finishers`).
const FINISHERS: Record<string, [string, string, string]> = {
	FLANKSTING_STRIKE: ["flank", "flankstung", "hindstung"],
	FLANKSBANE_FANG: ["flank", "flanksbane", "hindsbane"],
	HINDSTING_STRIKE: ["rear", "hindstung", "flanksbane"],
	HINDSBANE_FANG: ["rear", "hindsbane", "flankstung"],
};
const POSITION_AFTER: Record<string, string> = { HUNTERS_STING: "flank", SWIFTSKINS_STING: "rear" };

// xivgear's list with every finisher replaced by the one that is legal after the preceding second
// step and consumes the venom the previous finisher left (difference 2 above).
function legalSteps(): ActionKey[] {
	const steps = skills.map((r) => keyOf(r.name));
	let position: string | undefined;
	let venom: string | undefined;
	return steps.map((step) => {
		if (step in POSITION_AFTER) position = POSITION_AFTER[step];
		if (!(step in FINISHERS)) return step;
		const legal = Object.entries(FINISHERS).filter(([, [where]]) => where === position);
		const [finisher, [, , grants]] =
			legal.find(([, [, consumes]]) => consumes === venom) ?? legal[0];
		venom = grants;
		return finisher as ActionKey;
	});
}

function simulate(steps: ActionKey[]): RotationResult {
	const { gear } = fixture;
	return simulateRotation(
		{ id: "xivgear", steps },
		{
			encounterRules: true,
			timeZero: "firstPress",
			end: "settled",
			weaponDelay: gear.weaponDelay,
			config: {
				level: fixture.level,
				main: gear.dexterity,
				wd: gear.wdPhys,
				criticalHit: gear.crit,
				directHit: gear.dhit,
				determination: gear.determination,
				skillSpeed: gear.skillspeed,
				tenacity: gear.tenacity,
				partyBonus: fixture.partyBonus,
				fps: 0,
				countdown: 0,
			},
		},
		"VPR",
	);
}

const relative = (lab: number, xivgear: number) => (xivgear === 0 ? lab : lab / xivgear - 1);

describe("Rotation Lab vs xivgear's Viper sim", () => {
	const result = simulate(legalSteps());

	it("replays xivgear's whole action list as a valid rotation", () => {
		expect(skills.length).toBe(204);
		expect(result.errors).toEqual([]);
		expect(result.actions.filter((a) => !a.valid)).toEqual([]);
		expect(result.actions.map((a) => a.executedAction)).toEqual(legalSteps());
		expect(result.warnings).toEqual([]);
	});

	it("agrees on the expected damage of every action except the venom bites", () => {
		const mismatches = result.actions.flatMap((a, i) => {
			if (VENOM_BITES.includes(a.executedAction)) return [];
			const off = relative(a.expectedDamage!, skills[i].damage);
			return Math.abs(off) > TOLERANCE
				? [`#${i} ${skills[i].name}: Lab ${a.expectedDamage}, xivgear ${skills[i].damage}`]
				: [];
		});
		expect(mismatches).toEqual([]);
	});

	it("agrees on the total of those actions", () => {
		let lab = 0;
		let xivgear = 0;
		result.actions.forEach((a, i) => {
			if (VENOM_BITES.includes(a.executedAction)) return;
			lab += a.expectedDamage!;
			xivgear += skills[i].damage;
		});
		expect(xivgear).toBeGreaterThan(7_000_000);
		expect(Math.abs(relative(lab, xivgear))).toBeLessThan(TOLERANCE);
	});

	it("difference 1: the Lab gives the venom bites 170 potency, xivgear 120", () => {
		const bites = result.actions
			.map((a, i) => ({ a, x: skills[i] }))
			.filter(({ a }) => VENOM_BITES.includes(a.executedAction));
		expect(bites.length).toBe(42);
		for (const { a, x } of bites) {
			expect(x.potency).toBe(120);
			// 170 under Hunter's Instinct (+10 %), as the engine reports it.
			expect(a.appliedPotency).toBeCloseTo(187, 6);
			// Not exactly 170/120: the damage formula floors after the potency step.
			expect(a.expectedDamage! / x.damage).toBeCloseTo(170 / 120, 3);
		}
		const extra = bites.reduce((sum, { a, x }) => sum + a.expectedDamage! - x.damage, 0);
		// Over this 250 s list the Lab's skill damage is higher by this much, about 2.5 %.
		expect(extra / skills.reduce((sum, x) => sum + x.damage, 0)).toBeCloseTo(0.0252, 3);
	});

	it("difference 2: xivgear's own finisher names are not legal after its second steps", () => {
		const asIs = simulate(skills.map((r) => keyOf(r.name)));
		const swapped = asIs.actions.filter((a) => a.executedAction !== a.requestedAction);
		expect(swapped.length).toBe(17);
		expect(swapped.every((a) => a.requestedAction in FINISHERS)).toBe(true);
		expect(swapped.every((a) => a.executedAction in FINISHERS)).toBe(true);
	});

	it("difference 3: Ouroboros has a 3.0 s recast in the engine and 2.0 s in xivgear", () => {
		const next = (times: number[], names: string[]) => {
			const i = names.indexOf("OUROBOROS");
			return times[i + 1] - times[i];
		};
		const names = legalSteps();
		expect(
			next(
				skills.map((r) => r.time),
				names,
			),
		).toBeCloseTo(1.7, 6);
		expect(
			next(
				result.actions.map((a) => a.startTime),
				names,
			),
		).toBeCloseTo(2.55, 6);
		expect(fixture.derived.gcdHasted15).toBe(2.12);
	});

	it("agrees on what an auto-attack hits for, with and without Hunter's Instinct", () => {
		// Whole numbers, so that rounding in the fixture cannot split one value into two.
		const distinct = (values: number[]) => [...new Set(values.map(Math.round))].sort();
		const lab = result.damageEvents.filter((e) => e.isAutoAttack);
		expect(distinct(lab.map((e) => e.expectedDamage!))).toEqual(
			distinct(autos.map((r) => r.damage)),
		);
		// Both haste auto-attacks under Swiftscaled: 2.64 s unbuffed, then 2.244 s.
		const gaps = (times: number[]) => [times[1] - times[0], times[2] - times[1]];
		const labGaps = gaps(lab.map((e) => e.time));
		const xivgearGaps = gaps(autos.map((r) => r.time));
		expect(labGaps[0]).toBeCloseTo(xivgearGaps[0], 3);
		expect(labGaps[1]).toBeCloseTo(xivgearGaps[1], 3);
	});
});
