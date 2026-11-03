import { ActionKey, RESOURCES, ResourceKey } from "../../Game/Data";
import { actionLabel, Candidate, RecommenderContext } from "./context";

// Viper recommendations, implementing docs/rulesets/vpr-recommendations.md (draft v1). Row numbers
// in `rule` refer to its priority table (section 3). Choices the document leaves open are listed in
// its section 8.

type Upkeep = "HUNTERS_INSTINCT" | "SWIFTSCALED";
// Order for equal timers (e.g. both missing at the pull): Swiftscaled first.
const UPKEEP: Upkeep[] = ["SWIFTSCALED", "HUNTERS_INSTINCT"];

interface Family {
	// [Steel button, Reaving button]. The Steel button's second step (Hunter's Sting/Bite)
	// refreshes Hunter's Instinct, the Reaving button's (Swiftskin's Sting/Bite) Swiftscaled.
	starters: [ActionKey, ActionKey];
	combo: ResourceKey;
	vice: ActionKey;
	// The Vicewinder/Vicepit follow-ups, per buff they refresh.
	twinblades: Record<Upkeep, ActionKey>;
}

const SINGLE_TARGET: Family = {
	starters: ["STEEL_FANGS", "REAVING_FANGS"],
	combo: "VPR_COMBO",
	vice: "VICEWINDER",
	twinblades: { HUNTERS_INSTINCT: "HUNTERS_COIL", SWIFTSCALED: "SWIFTSKINS_COIL" },
};
const AOE: Family = {
	starters: ["STEEL_MAW", "REAVING_MAW"],
	combo: "VPR_AOE_COMBO",
	vice: "VICEPIT",
	twinblades: { HUNTERS_INSTINCT: "HUNTERS_DEN", SWIFTSCALED: "SWIFTSKINS_DEN" },
};

// Pending Coils/Dens. Any weaponskill other than Uncoiled Fury or Writhing Snap cancels them.
const PENDING_TWINBLADES: {
	button: ActionKey;
	ready: ResourceKey;
	buff: Upkeep;
	parent: string;
}[] = [
	{
		button: "HUNTERS_COIL",
		ready: "HUNTERS_COIL_READY",
		buff: "HUNTERS_INSTINCT",
		parent: "Vicewinder",
	},
	{
		button: "SWIFTSKINS_COIL",
		ready: "SWIFTSKINS_COIL_READY",
		buff: "SWIFTSCALED",
		parent: "Vicewinder",
	},
	{
		button: "HUNTERS_DEN",
		ready: "HUNTERS_DEN_READY",
		buff: "HUNTERS_INSTINCT",
		parent: "Vicepit",
	},
	{
		button: "SWIFTSKINS_DEN",
		ready: "SWIFTSKINS_DEN_READY",
		buff: "SWIFTSCALED",
		parent: "Vicepit",
	},
];

// oGCD follow-ups (section 5), all lost at the next weaponskill. `size`: how many are left.
const OGCD_FOLLOW_UPS: { ready: ResourceKey; buttons: ActionKey[]; counted: boolean }[] = [
	{ ready: "COIL_OGCD_READY", buttons: ["TWINFANG", "TWINBLOOD"], counted: true },
	{ ready: "DEN_OGCD_READY", buttons: ["TWINFANG", "TWINBLOOD"], counted: true },
	{ ready: "UNCOILED_OGCD_READY", buttons: ["TWINFANG", "TWINBLOOD"], counted: true },
	{ ready: "DEATH_RATTLE_READY", buttons: ["SERPENTS_TAIL"], counted: false },
	{ ready: "LAST_LASH_READY", buttons: ["SERPENTS_TAIL"], counted: false },
	// Holds the number of the next Legacy, not a count.
	{ ready: "LEGACY_READY", buttons: ["SERPENTS_TAIL"], counted: false },
];

// Buttons that show the Reawaken sequence while Reawakened.
const REAWAKEN_BUTTONS: ActionKey[] = [
	"STEEL_FANGS",
	"REAVING_FANGS",
	"HUNTERS_COIL",
	"SWIFTSKINS_COIL",
	"REAWAKEN",
];
const REAWAKEN_GCDS = new Set<ActionKey>([
	"FIRST_GENERATION",
	"SECOND_GENERATION",
	"THIRD_GENERATION",
	"FOURTH_GENERATION",
	"OUROBOROS",
]);

const TWIN_ACTIONS = new Set<ActionKey>([
	"TWINFANG_BITE",
	"TWINBLOOD_BITE",
	"TWINFANG_THRESH",
	"TWINBLOOD_THRESH",
	"UNCOILED_TWINFANG",
	"UNCOILED_TWINBLOOD",
]);

// Vicewinder/Vicepit counts as capping when the second charge is back within this many seconds.
const CHARGE_CAP_WINDOW = 5;

interface Detour {
	rule: string;
	reason: string;
	// The candidates this row adds, best first.
	buttons: ActionKey[];
	// The GCDs it inserts before the combo continues, and the buff each refreshes.
	gcds: { action: ActionKey; refreshes?: Upkeep }[];
}

const buffName = (buff: Upkeep) => RESOURCES[buff].name;

export function recommendViper(ctx: RecommenderContext): Candidate[] {
	const out: Candidate[] = [];
	const add = (button: ActionKey, rule: string, reason: string, group?: string) => {
		const shows = ctx.shows(button);
		if (!ctx.legal(shows)) return;
		out.push({
			action: button,
			shows,
			rule,
			reason,
			slots: ctx.isGcd(shows) ? undefined : 1,
			group,
		});
	};
	const last = ctx.lastGcd();
	const followUpReason = `follow-up of ${last ? actionLabel(last.executedAction) : "the last GCD"}`;

	// Row 2 (oGCDs): woven as a group right after the parent. A group that has started (one twin
	// pressed) finishes before Serpent's Ire.
	const followUps: Candidate[] = [];
	for (const group of OGCD_FOLLOW_UPS) {
		if (!ctx.has(group.ready)) continue;
		const size = group.counted ? ctx.amount(group.ready) : 1;
		const buttons = group.buttons
			.filter((b) => ctx.shows(b) !== b && ctx.legal(ctx.shows(b)))
			.sort(
				(a, b) =>
					Number(ctx.highlighted(ctx.shows(b))) - Number(ctx.highlighted(ctx.shows(a))),
			)
			.slice(0, size);
		for (const button of buttons) {
			followUps.push({
				action: button,
				shows: ctx.shows(button),
				rule: "2",
				reason: followUpReason,
				slots: 1,
				group: group.ready,
			});
		}
	}
	const previous = ctx.history[ctx.history.length - 1];
	const groupStarted = previous?.valid && TWIN_ACTIONS.has(previous.executedAction);
	if (groupStarted) out.push(...followUps);
	// Row 1.
	add("SERPENTS_IRE", "1", "Ire ready");
	if (!groupStarted) out.push(...followUps);

	// While Reawakened, the sequence fills the list (row 2): the engine highlights the next step.
	if (ctx.has("REAWAKENED")) {
		const steps = REAWAKEN_BUTTONS.filter((b) => {
			const shows = ctx.shows(b);
			return REAWAKEN_GCDS.has(shows) && ctx.legal(shows);
		});
		const next = steps.filter((b) => ctx.highlighted(ctx.shows(b)));
		(next.length > 0 ? next : steps).forEach((b) => add(b, "2", followUpReason));
		// Uncoiled Fury does not touch the Reawaken combo, so it stays available below the
		// sequence (user, session 4). Like any weaponskill it drops a pending Legacy, which is
		// woven first.
		if (ctx.amount("RATTLING_COIL") >= 1) {
			const capped =
				ctx.amount("RATTLING_COIL") >= ctx.game.resources.get("RATTLING_COIL").maxValue;
			add("UNCOILED_FURY", capped ? "5b" : "10", capped ? "coil cap" : "spend coil");
		}
		return out;
	}

	// The AoE family at 3+ enemies, counted for its first step's press and damage application.
	const family = ctx.enemiesFor(AOE.starters[0]) >= 3 ? AOE : SINGLE_TARGET;
	const [steel, reaving] = family.starters;
	const remaining = (buff: Upkeep) => ctx.timer(buff);
	const byTimer = [...UPKEEP].sort((a, b) => remaining(a) - remaining(b));
	const lower = byTimer[0];
	const combo = ctx.amount(family.combo);
	// The combo value at which the next GCD is the second step (sting or bite).
	const atSecondStep = combo === 1;
	const stingFor = (buff: Upkeep) => (buff === "HUNTERS_INSTINCT" ? steel : reaving);
	// Row 9: the next combo step. Step 2 refreshes the buff with less time left; otherwise the
	// engine's highlight (Honed buffs, venoms) picks the button.
	const comboStep = (): ActionKey =>
		atSecondStep
			? stingFor(lower)
			: ([steel, reaving].find((b) => ctx.highlighted(ctx.shows(b))) ?? steel);
	// GCDs before the combo path reaches the second step.
	const stepsToSecond = atSecondStep ? 0 : combo === 0 ? 1 : 2;

	const pending = PENDING_TWINBLADES.filter(
		(t) => ctx.has(t.ready) && ctx.legal(ctx.shows(t.button)),
	)
		// Rule 1 order: the lower buff first.
		.sort((a, b) => byTimer.indexOf(a.buff) - byTimer.indexOf(b.buff));
	const twinbladeOrder = byTimer.map((buff) => ({
		action: family.twinblades[buff],
		refreshes: buff,
	}));

	const viceCd = ctx.game.cooldowns.get("cd_VICEWINDER");
	const viceLegal = pending.length === 0 && ctx.legal(ctx.shows(family.vice));
	const charges = viceCd.stacksAvailable();
	const viceCap =
		viceLegal &&
		(charges >= viceCd.maxStacks() ||
			(charges === viceCd.maxStacks() - 1 &&
				viceCd.timeTillNextStackAvailable() <= CHARGE_CAP_WINDOW));
	// Section 4: the burst runs from Serpent's Ire to the end of the Reawakened it readies. Outside
	// Reawakened (handled above), that is while Ready to Reawaken is up.
	const inBurst = ctx.has("READY_TO_REAWAKEN");

	// Rows 5-8: what would be inserted before the combo continues.
	const detours: Detour[] = [];
	if (pending.length > 0) {
		detours.push({
			rule: "5a",
			reason: `follow-up of ${pending[0].parent}`,
			buttons: pending.map((p) => p.button),
			gcds: pending.map((p) => ({ action: p.button, refreshes: p.buff })),
		});
	} else if (viceCap) {
		detours.push({
			rule: "5a",
			reason: "charge cap",
			buttons: [family.vice],
			gcds: [{ action: family.vice }, ...twinbladeOrder],
		});
	}
	if (
		ctx.legal("UNCOILED_FURY") &&
		ctx.amount("RATTLING_COIL") >= ctx.game.resources.get("RATTLING_COIL").maxValue
	) {
		detours.push({
			rule: "5b",
			reason: "coil cap",
			buttons: ["UNCOILED_FURY"],
			gcds: [{ action: "UNCOILED_FURY" }],
		});
	}
	if (ctx.legal(ctx.shows("REAWAKEN"))) {
		const offerings = ctx.amount("SERPENT_OFFERINGS");
		const nextGain = pending.length > 0 ? 5 : 10;
		const row =
			offerings >= 50 && offerings + nextGain > 100
				? { rule: "5c", reason: "offering cap" }
				: ctx.has("READY_TO_REAWAKEN")
					? { rule: "6", reason: "Ready to Reawaken" }
					: offerings >= 50
						? { rule: "7", reason: "available, not urgent" }
						: undefined;
		if (row) {
			const generations: ActionKey[] = [
				"FIRST_GENERATION",
				"SECOND_GENERATION",
				"THIRD_GENERATION",
				"FOURTH_GENERATION",
			];
			// Ouroboros comes with the fifth Anguine Tribute (level 96).
			if (ctx.game.resources.get("ANGUINE_TRIBUTE").maxValue >= 5)
				generations.push("OUROBOROS");
			detours.push({
				...row,
				buttons: ["REAWAKEN"],
				gcds: [{ action: "REAWAKEN" }, ...generations.map((action) => ({ action }))],
			});
		}
	}
	if (!viceCap && viceLegal && !inBurst) {
		detours.push({
			rule: "8",
			reason: "on cooldown outside burst",
			buttons: [family.vice],
			gcds: [{ action: family.vice }, ...twinbladeOrder],
		});
	}

	// When each buff would next be refreshed if rows 5-8 went first, then the combo continued.
	const gcdLength = ctx.recast(steel);
	let t = ctx.gcdIn;
	const refreshAt = new Map<Upkeep, number>();
	for (const detour of detours) {
		for (const gcd of detour.gcds) {
			if (gcd.refreshes && !refreshAt.has(gcd.refreshes)) refreshAt.set(gcd.refreshes, t);
			t += ctx.recast(gcd.action);
		}
	}
	const detourEnd = t;
	for (const buff of byTimer) {
		if (!refreshAt.has(buff)) {
			refreshAt.set(buff, t + (stepsToSecond + (buff === lower ? 0 : 3)) * gcdLength);
		}
	}

	// Rules 0 and 1 never move a combo step above pending Coils/Dens, which it would cancel.
	if (pending.length === 0 && combo > 0 && detourEnd > ctx.gcdIn) {
		// Rule 0: the combo timer would run out during the rows 5-8 detour.
		if (ctx.timer(family.combo) < detourEnd) add(comboStep(), "3", "combo would time out");
	}

	// Rule 1: refresh a buff that would expire before its next refresh, the quickest way.
	for (const buff of byTimer) {
		if (remaining(buff) >= refreshAt.get(buff)!) continue;
		const reason = ctx.has(buff)
			? `${buffName(buff)} would expire`
			: `${buffName(buff)} is not up`;
		const options: { button: ActionKey; at: number }[] = [];
		const coil = pending.find((p) => p.buff === buff);
		if (coil) options.push({ button: coil.button, at: ctx.gcdIn });
		if (pending.length === 0) {
			options.push(
				atSecondStep
					? { button: stingFor(buff), at: ctx.gcdIn }
					: {
							button: comboStep(),
							at: ctx.gcdIn + (stepsToSecond + (buff === lower ? 0 : 3)) * gcdLength,
						},
			);
		}
		if (viceLegal) {
			const first = byTimer[0] === buff;
			const at =
				ctx.gcdIn +
				ctx.recast(family.vice) +
				(first ? 0 : ctx.recast(family.twinblades[byTimer[0]]));
			options.push({ button: family.vice, at });
		}
		// Ties go to the earlier option: the pending Coil, then the combo path.
		const best = options.reduce<(typeof options)[number] | undefined>(
			(a, b) => (a === undefined || b.at < a.at ? b : a),
			undefined,
		);
		if (best) add(best.button, "4", reason);
	}

	for (const detour of detours) {
		detour.buttons.forEach((b) => add(b, detour.rule, detour.reason));
	}
	// Row 9.
	add(comboStep(), "9", "combo step");
	// Row 10.
	if (ctx.amount("RATTLING_COIL") >= 1) add("UNCOILED_FURY", "10", "spend coil");
	return out;
}
