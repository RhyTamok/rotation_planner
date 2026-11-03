import { describe, expect, it } from "vitest";

import { ActionKey } from "../Game/Data";
import { arrange, Candidate } from "../RotationLab/recommend/context";
import { recommendAfter, Recommendations } from "../RotationLab/recommend/recommender";
import { DowntimeWindow, RotationStep } from "../RotationLab/simulation/types";

// Viper ruleset: docs/rulesets/vpr-recommendations.md. Test names cite its priority rows.

type Step = ActionKey | RotationStep;
type Override = { type: string; stacks: number; timeTillFullOrDrop: number };

// Gauges, buffs and cooldowns at the start of the countdown (-5 s). Timers keep running from
// there, so a pull at 0 s uses about 5 s of them.
const set = (type: string, stacks: number, time = 0): Override => ({
	type,
	stacks,
	timeTillFullOrDrop: time,
});
const BUFFS_UP = [set("HUNTERS_INSTINCT", 1, 60), set("SWIFTSCALED", 1, 60)];
// Writhing Snap starts combat without touching combos, Coils or follow-ups.
const PULL: Step = "WRITHING_SNAP";

function recommend(
	steps: Step[],
	overrides: Override[] = BUFFS_UP,
	extra: { targets?: number; downtime?: DowntimeWindow[] } = {},
): Recommendations {
	return recommendAfter(
		"VPR",
		steps.map((s) => (typeof s === "string" ? { type: "skill", action: s } : s)),
		{
			encounterRules: true,
			downtime: extra.downtime,
			config: {
				fps: 0,
				initialResourceOverrides: overrides.map((o) => ({
					...o,
					effectOrTimerEnabled: true,
				})) as never,
			},
		},
		extra.targets ?? 1,
	)!;
}

const shows = (r: Recommendations) => r.ranked.map((x) => x.shows);
const entry = (r: Recommendations, action: ActionKey) => r.ranked.find((x) => x.shows === action);
const indexOf = (r: Recommendations, action: ActionKey) => shows(r).indexOf(action);

describe("Rotation Lab - Viper recommendations", () => {
	it("lists GCDs and oGCDs with the rule and reason that placed them", () => {
		const r = recommend([PULL]);
		expect(r.ranked[0]).toEqual({
			action: "SERPENTS_IRE",
			shows: "SERPENTS_IRE",
			rule: "1",
			reason: "Ire ready",
		});
		expect(entry(r, "STEEL_FANGS")).toMatchObject({ rule: "9", reason: "combo step" });
	});

	it("reports the buff timers at the insertion point", () => {
		const labels = recommend(["REAVING_FANGS", "REAVING_FANGS"], []).resources.timers.map(
			(t) => t.label,
		);
		expect(labels).toContain("Swiftscaled");
		expect(labels).not.toContain("Hunter's Instinct");
	});

	it("does not recommend Serpent's Ire before combat (legality comes from the engine)", () => {
		expect(entry(recommend([]), "SERPENTS_IRE")).toBeUndefined();
	});

	describe("row 2: direct follow-ups", () => {
		it("weaves both twins after a Coil, the buffed one first", () => {
			const r = recommend([PULL, "VICEWINDER", "HUNTERS_COIL"]);
			expect(r.ranked.slice(0, 2)).toMatchObject([
				{ shows: "TWINFANG_BITE", rule: "2", reason: "follow-up of Hunter's Coil" },
				{ shows: "TWINBLOOD_BITE", rule: "2", reason: "follow-up of Hunter's Coil" },
			]);
		});

		it("keeps the twins together: Serpent's Ire waits for the next GCD", () => {
			const r = recommend([PULL, "VICEWINDER", "HUNTERS_COIL"]);
			const firstGcd = indexOf(r, "SWIFTSKINS_COIL");
			expect(firstGcd).toBe(2);
			expect(indexOf(r, "SERPENTS_IRE")).toBe(firstGcd + 1);
			expect(entry(r, "SERPENTS_IRE")!.reason).toBe("Ire ready; no weave slot");
		});

		it("finishes a started pair before Serpent's Ire", () => {
			const r = recommend([PULL, "VICEWINDER", "HUNTERS_COIL", "TWINFANG"]);
			expect(r.ranked[0]).toMatchObject({ action: "TWINBLOOD", shows: "TWINBLOOD_BITE" });
			expect(indexOf(r, "SERPENTS_IRE")).toBeGreaterThan(indexOf(r, "SWIFTSKINS_COIL"));
		});

		it("puts Serpent's Ire first when it fits next to a single follow-up", () => {
			const r = recommend([PULL, "STEEL_FANGS", "STEEL_FANGS", "STEEL_FANGS"]);
			expect(shows(r).slice(0, 2)).toEqual(["SERPENTS_IRE", "DEATH_RATTLE"]);
			expect(r.ranked[1].reason).toBe("follow-up of Flanksting Strike");
		});

		it("ranks the GCD first when both weave slots are used", () => {
			const r = recommend([PULL, "VICEWINDER", "HUNTERS_COIL", "TRUE_NORTH", "BLOODBATH"]);
			expect(r.ranked[0].shows).toBe("SWIFTSKINS_COIL");
			expect(entry(r, "TWINFANG_BITE")!.reason).toBe(
				"follow-up of Hunter's Coil; no weave slot",
			);
		});

		it("fills the list with the Reawaken sequence while Reawakened", () => {
			const offerings = [...BUFFS_UP, set("SERPENT_OFFERINGS", 50)];
			expect(shows(recommend([PULL, "REAWAKEN"], offerings))).toEqual([
				"SERPENTS_IRE",
				"FIRST_GENERATION",
			]);
			const r = recommend([PULL, "REAWAKEN", "STEEL_FANGS"], offerings);
			expect(shows(r)).toEqual(["SERPENTS_IRE", "FIRST_LEGACY", "SECOND_GENERATION"]);
			expect(r.ranked[1].reason).toBe("follow-up of First Generation");
		});

		it("keeps Uncoiled Fury listed below the Reawaken sequence", () => {
			const coils = [...BUFFS_UP, set("SERPENT_OFFERINGS", 50), set("RATTLING_COIL", 1)];
			const r = recommend([PULL, "REAWAKEN", "STEEL_FANGS"], coils);
			expect(shows(r)).toEqual([
				"SERPENTS_IRE",
				"FIRST_LEGACY",
				"SECOND_GENERATION",
				"UNCOILED_FURY",
			]);
			expect(r.ranked[3]).toMatchObject({ rule: "10", reason: "spend coil" });
			const capped = recommend(
				[PULL, "REAWAKEN"],
				[...BUFFS_UP, set("SERPENT_OFFERINGS", 50), set("RATTLING_COIL", 3)],
			);
			expect(entry(capped, "UNCOILED_FURY")).toMatchObject({
				rule: "5b",
				reason: "coil cap",
			});
			expect(indexOf(capped, "UNCOILED_FURY")).toBeGreaterThan(
				indexOf(capped, "FIRST_GENERATION"),
			);
		});
	});

	describe("row 3 (Rule 0): combo timer", () => {
		// Hunter's Instinct has less time left, so step 2 is Hunter's Sting.
		const buffs = [set("HUNTERS_INSTINCT", 1, 50), set("SWIFTSCALED", 1, 60)];

		it("moves the combo step above a detour that would outlast the combo", () => {
			const r = recommend([PULL], [...buffs, set("VPR_COMBO", 1, 12)]);
			expect(entry(r, "HUNTERS_STING")).toMatchObject({
				rule: "3",
				reason: "combo would time out",
			});
			expect(indexOf(r, "HUNTERS_STING")).toBeLessThan(indexOf(r, "VICEWINDER"));
		});

		it("leaves the combo step at row 9 when the combo outlasts the detour", () => {
			const r = recommend([PULL], [...buffs, set("VPR_COMBO", 1, 30)]);
			expect(entry(r, "HUNTERS_STING")!.rule).toBe("9");
			expect(indexOf(r, "VICEWINDER")).toBeLessThan(indexOf(r, "HUNTERS_STING"));
		});
	});

	describe("row 4 (Rule 1): buff upkeep", () => {
		// Reawaken (row 7) would take about 13 s; Vicewinder is on cooldown.
		const base = [
			set("HUNTERS_INSTINCT", 1, 60),
			set("VPR_COMBO", 1, 30),
			set("SERPENT_OFFERINGS", 50),
			set("cd_VICEWINDER", 0, 79),
		];

		it("refreshes a buff that would expire during the detour", () => {
			const r = recommend([PULL], [...base, set("SWIFTSCALED", 1, 12)]);
			expect(r.ranked[1]).toMatchObject({
				action: "REAVING_FANGS",
				shows: "SWIFTSKINS_STING",
				rule: "4",
				reason: "Swiftscaled would expire",
			});
			expect(indexOf(r, "SWIFTSKINS_STING")).toBeLessThan(indexOf(r, "REAWAKEN"));
		});

		it("does not refresh early when the buff lasts", () => {
			const r = recommend([PULL], [...base, set("SWIFTSCALED", 1, 40)]);
			expect(entry(r, "REAWAKEN")!.rule).toBe("7");
			// Still the buff with less time left, but no longer pulled up to row 4.
			expect(entry(r, "SWIFTSKINS_STING")!.rule).toBe("9");
			expect(r.ranked.filter((x) => x.rule === "4")).toEqual([]);
		});

		it("takes the quickest refresh: Vicewinder's Coil beats the combo path", () => {
			// After Steel Fangs and Swiftskin's Sting, Hunter's Instinct is not up yet.
			const r = recommend(["STEEL_FANGS", "REAVING_FANGS"], []);
			expect(entry(r, "VICEWINDER")).toMatchObject({
				rule: "4",
				reason: "Hunter's Instinct is not up",
			});
		});

		it("starts with the combo when both buffs are missing, Swiftscaled first", () => {
			const r = recommend([], []);
			expect(r.ranked[0]).toMatchObject({ rule: "4", reason: "Swiftscaled is not up" });
			expect(shows(recommend(["STEEL_FANGS"], []))[0]).toBe("SWIFTSKINS_STING");
		});
	});

	describe("rows 5-8: caps, Reawaken and Vicewinder", () => {
		it("5a: Vicewinder at 2 charges", () => {
			expect(entry(recommend([PULL]), "VICEWINDER")).toMatchObject({
				rule: "5a",
				reason: "charge cap",
			});
		});

		it("5a: Vicewinder when the second charge is back within 5 s", () => {
			const soon = recommend([PULL], [...BUFFS_UP, set("cd_VICEWINDER", 1, 8)]);
			expect(entry(soon, "VICEWINDER")!.rule).toBe("5a");
			const later = recommend([PULL], [...BUFFS_UP, set("cd_VICEWINDER", 1, 20)]);
			expect(entry(later, "VICEWINDER")).toMatchObject({
				rule: "8",
				reason: "on cooldown outside burst",
			});
		});

		it("5a: pending Coils outrank Reawaken, which would cancel them", () => {
			const r = recommend(["VICEWINDER"], [...BUFFS_UP, set("SERPENT_OFFERINGS", 50)]);
			expect(entry(r, "HUNTERS_COIL")).toMatchObject({
				rule: "5a",
				reason: "follow-up of Vicewinder",
			});
			expect(indexOf(r, "SWIFTSKINS_COIL")).toBeLessThan(indexOf(r, "REAWAKEN"));
		});

		it("5b: Uncoiled Fury at 3 Rattling Coils, above Reawaken", () => {
			const r = recommend(
				[PULL],
				[...BUFFS_UP, set("RATTLING_COIL", 3), set("SERPENT_OFFERINGS", 50)],
			);
			expect(entry(r, "UNCOILED_FURY")).toMatchObject({ rule: "5b", reason: "coil cap" });
			expect(indexOf(r, "UNCOILED_FURY")).toBeLessThan(indexOf(r, "REAWAKEN"));
		});

		it("5c / 7: Reawaken before the next finisher would overcap Offerings", () => {
			const cap = recommend([PULL], [...BUFFS_UP, set("SERPENT_OFFERINGS", 95)]);
			expect(entry(cap, "REAWAKEN")).toMatchObject({ rule: "5c", reason: "offering cap" });
			const spare = recommend([PULL], [...BUFFS_UP, set("SERPENT_OFFERINGS", 60)]);
			expect(entry(spare, "REAWAKEN")).toMatchObject({
				rule: "7",
				reason: "available, not urgent",
			});
			expect(entry(recommend([PULL]), "REAWAKEN")).toBeUndefined();
		});

		it("6 and the burst window: Ready to Reawaken holds Vicewinder back", () => {
			const charge = set("cd_VICEWINDER", 1, 30);
			const burst = recommend([PULL], [...BUFFS_UP, charge, set("READY_TO_REAWAKEN", 1, 30)]);
			expect(entry(burst, "REAWAKEN")).toMatchObject({
				rule: "6",
				reason: "Ready to Reawaken",
			});
			expect(entry(burst, "VICEWINDER")).toBeUndefined();
			expect(entry(recommend([PULL], [...BUFFS_UP, charge]), "VICEWINDER")!.rule).toBe("8");
		});
	});

	it("rows 9 and 10: the combo step, then spending a Rattling Coil", () => {
		const r = recommend(
			[PULL],
			[...BUFFS_UP, set("RATTLING_COIL", 1), set("cd_VICEWINDER", 0, 79)],
		);
		expect(r.ranked.slice(1)).toMatchObject([
			{ shows: "STEEL_FANGS", rule: "9" },
			{ shows: "UNCOILED_FURY", rule: "10", reason: "spend coil" },
		]);
	});

	it("uses the AoE family at 3 or more targets", () => {
		const r = recommend([PULL], BUFFS_UP, { targets: 3 });
		expect(entry(r, "VICEPIT")!.rule).toBe("5a");
		expect(entry(r, "STEEL_MAW")!.rule).toBe("9");
		expect(entry(r, "STEEL_FANGS")).toBeUndefined();
		const two = recommend([PULL], BUFFS_UP, { targets: 2 });
		expect(entry(two, "VICEWINDER")).toBeDefined();
	});

	it("moves actions that need a target to the filtered list during downtime", () => {
		const r = recommend([PULL], [...BUFFS_UP, set("SERPENT_OFFERINGS", 50)], {
			downtime: [{ start: 1, end: 30 }],
		});
		expect(shows(r)).toEqual(["SERPENTS_IRE", "REAWAKEN"]);
		expect(r.filtered.map((x) => x.shows)).toEqual(["VICEWINDER", "STEEL_FANGS"]);
		expect(r.filtered[0].reason).toBe("charge cap; needs a target");
	});
});

describe("Rotation Lab - recommendation weave slots", () => {
	const gcd = (action: ActionKey): Candidate => ({
		action,
		shows: action,
		rule: "9",
		reason: "",
	});
	const ogcd = (action: ActionKey, group?: string): Candidate => ({
		...gcd(action),
		rule: "2",
		slots: 1,
		group,
	});

	it("reserves slots for a follow-up group before other oGCDs", () => {
		const out = arrange(
			[
				ogcd("SERPENTS_IRE"),
				ogcd("TWINFANG", "g"),
				ogcd("TWINBLOOD", "g"),
				gcd("STEEL_FANGS"),
			],
			2,
		);
		expect(out.map((x) => x.action)).toEqual([
			"TWINFANG",
			"TWINBLOOD",
			"STEEL_FANGS",
			"SERPENTS_IRE",
		]);
	});

	it("drops duplicates, keeping the higher entry", () => {
		const out = arrange([gcd("STEEL_FANGS"), { ...gcd("STEEL_FANGS"), rule: "3" }], 2);
		expect(out).toHaveLength(1);
		expect(out[0].rule).toBe("9");
	});
});
