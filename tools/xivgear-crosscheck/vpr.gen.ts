// Generates the reference fixture for src/__test__/rotationLabXivgearSim.test.ts by running
// xivgear's own Viper sim (https://github.com/xiv-gear-planner/gear-planner, reused with the
// author's permission) from a local clone. See README.md in this folder.
// @ts-nocheck: the imports resolve only through this folder's vitest config.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { makeFakeSet } from "@xivgear/core/test/test_utils";
import { VprSheetSim } from "@xivgear/sims/melee/vpr/vpr_sheet_sim";
import { RawStats } from "@xivgear/xivmath/geartypes";
import { getClassJobStats, getLevelStats, getRaceStats } from "@xivgear/xivmath/xivconstants";
import { finalizeStats } from "@xivgear/xivmath/xivstats";

const CLONE = process.env.XIVGEAR_DIR ?? join(homedir(), "dev/gear-planner/gear-planner");
const OUT = "src/__test__/Asset/xivgear/vpr_100_crosscheck.json";

const LEVEL = 100;
// A plausible level-100 Viper set. Final values: gear, food and race included, no party bonus.
const GEAR = {
	dexterity: 6000,
	wdPhys: 152,
	weaponDelay: 2.64,
	crit: 3300,
	dhit: 2100,
	determination: 2400,
	skillspeed: 420,
	tenacity: 420,
};
// Seconds of fight. Long enough for the opener, a full two-minute cycle and the second burst.
const TOTAL_TIME = 250;

it("writes the Viper cross-check fixture", async () => {
	const stats = finalizeStats(
		new RawStats({ ...GEAR, vitality: 5000, strength: 400, hp: 0 }),
		{},
		LEVEL,
		getLevelStats(LEVEL),
		"VPR",
		{
			...getClassJobStats("VPR"),
			// Normally loaded from the game data API. Only dexterity enters Viper's damage.
			jobStatMultipliers: {
				dexterity: 110,
				strength: 100,
				vitality: 100,
				intelligence: 100,
				mind: 100,
				hp: 100,
			},
		},
		0,
		getRaceStats(undefined),
	);
	const sim = new VprSheetSim();
	sim.cycleSettings.totalTime = TOTAL_TIME;
	sim.cycleSettings.which = "totalTime";
	// The sim's default: the last GCD may be cut short and its damage pro-rated. Such a record is
	// marked `partial` and the Lab test leaves it out. ("strict-gcd" never ends this sim's loop.)
	sim.cycleSettings.cutoffMode = "prorate-gcd";
	const { best } = await sim.simulate(makeFakeSet(stats));

	const records = best.displayRecords
		.filter((r) => "ability" in r)
		.map((r) => ({
			time: round(r.usedAt, 4),
			name: r.ability.name,
			type: r.ability.type,
			potency: r.totalPotency,
			damage: round(r.totalDamage, 3),
			buffs: r.buffs.map((b) => b.name),
			partial: r.partialRate ?? undefined,
		}));
	const fixture = {
		source: {
			repository: "https://github.com/xiv-gear-planner/gear-planner",
			commit: execFileSync("git", ["-C", CLONE, "rev-parse", "HEAD"]).toString().trim(),
			sim: sim.spec.stub,
			generator: "tools/xivgear-crosscheck/vpr.gen.ts",
		},
		level: LEVEL,
		gear: GEAR,
		partyBonus: 0,
		settings: { ...sim.cycleSettings },
		derived: {
			mainStatMulti: stats.mainStatMulti,
			wdMulti: stats.wdMulti,
			aaMulti: stats.aaMulti,
			detMulti: stats.detMulti,
			critChance: stats.critChance,
			critMulti: stats.critMulti,
			dhitChance: stats.dhitChance,
			gcd: stats.gcdPhys(2.5),
			gcdHasted15: stats.gcdPhys(2.5, 15),
		},
		totalDamage: round(best.totalDamage.expected, 3),
		totalTime: best.totalTime,
		records,
	};
	writeFileSync(OUT, JSON.stringify(fixture, null, "\t") + "\n");
});

function round(x: number, digits: number) {
	return Number(x.toFixed(digits));
}
