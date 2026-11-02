import { describe, expect, it, vi } from "vitest";

import {
	fullDataUrl,
	importFromXivgear,
	isXivgearLink,
	parseFullData,
} from "../RotationLab/import/xivgear";

// The shape of xivgear's /fulldata response (packages/xivmath geartypes.ts: SheetExport with
// SetStatsExport sets), trimmed to the fields the import reads.
function set(name: string, overrides: Record<string, unknown> = {}) {
	return {
		name,
		computedStats: {
			// Pre-party-bonus main stat; dexterity is Viper's.
			gearStats: { strength: 450, dexterity: 6100, intelligence: 400, mind: 400 },
			// Includes food.
			crit: 3100,
			dhit: 1500,
			determination: 2200,
			skillspeed: 500,
			tenacity: 420,
			wdPhys: 146,
			wdMag: 146,
			weaponDelay: 2.64,
			...overrides,
		},
	};
}

const sheet = {
	name: "VPR 7.x",
	job: "VPR",
	level: 100,
	partyBonus: 5,
	sets: [set("2.50 BiS"), { name: "---", isSeparator: true }, set("2.46", { skillspeed: 900 })],
};

describe("Rotation Lab - xivgear import", () => {
	it("recognizes xivgear links and builds the full-data request", () => {
		expect(isXivgearLink("https://xivgear.app/sl/a5a57d96")).toBe(true);
		expect(isXivgearLink("https://xivgear.app/?page=sl|a5a57d96")).toBe(true);
		expect(isXivgearLink("https://etro.gg/gearset/x")).toBe(false);
		expect(isXivgearLink("not a link")).toBe(false);
		expect(fullDataUrl(" https://xivgear.app/?page=sl|abc ")).toBe(
			"https://api.xivgear.app/fulldata?url=https%3A%2F%2Fxivgear.app%2F%3Fpage%3Dsl%7Cabc",
		);
	});

	it("imports every set of a sheet with food-inclusive substats and pre-bonus main stat", () => {
		const result = parseFullData(sheet, "VPR");
		expect(result.gearSets.map((g) => g.name)).toEqual(["2.50 BiS", "2.46"]);
		expect(result.gearSets[0].stats).toEqual({
			main: 6100,
			wd: 146,
			criticalHit: 3100,
			directHit: 1500,
			determination: 2200,
			skillSpeed: 500,
			tenacity: 420,
		});
		expect(result.gearSets[0].weaponDelay).toBe(2.64);
		expect(result.gearSets[1].stats.skillSpeed).toBe(900);
		expect(result.gearSets[0].id).not.toBe(result.gearSets[1].id);
		expect(result.level).toBe(100);
		expect(result.warnings).toEqual([]);
	});

	it("refuses another job's sets and reports unusable ones", () => {
		expect(() => parseFullData({ ...sheet, job: "DRG" }, "VPR")).toThrow("for DRG, not VPR");
		const partial = parseFullData(
			{ ...sheet, sets: [set("ok"), { name: "empty" }, set("bad", { crit: undefined })] },
			"VPR",
		);
		expect(partial.gearSets.map((g) => g.name)).toEqual(["ok"]);
		expect(partial.warnings).toHaveLength(2);
		expect(() => parseFullData({ ...sheet, sets: [] }, "VPR")).toThrow("no gear sets");
	});

	it("fetches through the API and explains failures", async () => {
		const ok = vi.fn(async () => new Response(JSON.stringify(sheet), { status: 200 }));
		const result = await importFromXivgear("https://xivgear.app/sl/abc", "VPR", ok);
		expect(ok).toHaveBeenCalledWith(
			fullDataUrl("https://xivgear.app/sl/abc"),
			expect.anything(),
		);
		expect(result.gearSets).toHaveLength(2);

		const missing = vi.fn(async () => new Response("", { status: 404 }));
		await expect(importFromXivgear("https://xivgear.app/sl/x", "VPR", missing)).rejects.toThrow(
			"could not find",
		);
		const offline = vi.fn(async () => {
			throw new TypeError("network");
		});
		await expect(importFromXivgear("https://xivgear.app/sl/x", "VPR", offline)).rejects.toThrow(
			"internet connection",
		);
		await expect(importFromXivgear("https://etro.gg/x", "VPR", ok)).rejects.toThrow(
			"xivgear.app",
		);
	});
});
