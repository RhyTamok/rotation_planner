# Dragoon action recommendation ruleset (draft v1)

Status: design agreed with the user (grilling session, 2026-11-03). Not implemented. Same structure
and output as `vpr-recommendations.md`; only the differences and the DRG rules are written here.
Level 100 only (Evercold / level 110 later, as a separate ruleset).

## 1. Purpose and output

Identical to Viper section 1: one ranked list of GCDs and oGCDs (`action`, `rank`, `reason`);
phase 1 shows the whole list, phase 2 only the best entry. Legality (engine `validateAttempt`,
combo state, encounter rules) is separate from priority; priority only ranks and never removes
an action. A follow-up takes its parent's slot. Positionals are ignored. The recommender uses
the engine's replaced action (`replaceIf`: Raiden Thrust / True Thrust, Draconian Fury / Doom
Spike, Drakesbane, Starcross / Stardiver).

## 2. Inputs

- Combo trackers `DRG_CHAOS_COMBO_TRACKER`, `DRG_HEAVENS_COMBO_TRACKER`, `DRG_AOE_COMBO_TRACKER`.
- Buffs `LANCE_CHARGE`, `LIFE_OF_THE_DRAGON`, `BATTLE_LITANY`, `LIFE_SURGE`,
  `ENHANCED_PIERCING_TALON`; follow-up statuses (section 5) with their remaining time.
- `FIRSTMINDS_FOCUS` (scales), `cd_LIFE_SURGE` charges, every oGCD cooldown.
- Target count (shared per-rotation setting, default 1; see section 8).
- **History** (read-only): which branch the last combo took (section 3), oGCDs pressed since the
  last GCD (section 4), Life Surges pressed since the last Lance Charge (section 6).

## 3. GCD choice (combo step)

DRG has one chain that refreshes itself, so there is **no combo-timer rule and no buff-upkeep
rule** (no Rule 0 / Rule 1). Power Surge and Draconian Fire are not guarded.

| Targets | Family |
|---------|--------|
| 1 | Alternate Chaos and Heavens branches. |
| 2 | Chaos branch only (Heavens stays legal, ranked below). |
| >= 3 | AoE chain (Doom Spike / Draconian Fury -> Sonic Thrust -> Coerthan Torment). |

- Chaos: True/Raiden Thrust -> Disembowel/Spiral Blow -> Chaos Thrust/Chaotic Spring -> Wheeling
  Thrust -> Drakesbane. Heavens: True/Raiden Thrust -> Vorpal Thrust/Lance Barrage -> Full/Heavens'
  Thrust -> Fang and Claw -> Drakesbane.
- **Finishing an active combo always ranks first.** The target-count rule only picks the branch at
  the start of a new combo. A mid-combo target-count change is a niche case and is not handled.
- Single target alternation reads the **action history**: the most recent branch-defining step
  (Disembowel/Spiral Blow/Chaos... = Chaos; Vorpal/Lance Barrage/Heavens... = Heavens). The next
  combo uses the other branch. With no history, start with Chaos. No engine change.

## 4. Weave slots

DRG has a static GCD length, so each GCD has **2 weave slots**.

- Slots used = oGCDs in the history since the last GCD; a GCD resets it to 0.
- Stardiver costs 2 slots and is only recommended with 0 slots used. Every other oGCD costs 1
  (Life Surge, Mirage Dive and the follow-ups included).
- An oGCD that does not fit stays in the list, ranked below the GCD, reason "no weave slot".
- With 2 slots used the GCD ranks first. An expiring follow-up (< 5 s) is still lost in that case.
- Triple-weaving with very low ping is ignored until Evercold specifics are known.

## 5. Priority table (top = highest)

All oGCD rows require a free slot (section 4) and that the action is legal (off cooldown, status up).

| # | Entry | Notes |
|---|-------|-------|
| 1 | Follow-up with < 5 s left | Nastrond, Mirage Dive, Rise of the Dragon, Starcross; least time first. Stardiver joins this row when < 5 s of Life of the Dragon remain (needs 2 slots). |
| 2 | Lance Charge | |
| 3 | Geirskogul | |
| 4 | Battle Litany | |
| 5 | Life Surge | Only under the rules in section 6. |
| 6 | High Jump | |
| 7 | Dragonfire Dive | |
| 8 | Stardiver | Only legal inside Life of the Dragon. |
| 9 | Wyrmwind Thrust | At exactly 2 scales; shown whenever available, even if a burst is near (holding it is a manual call). |
| 10 | Follow-up with >= 5 s left | Same set as row 1; least time first. |
| 11 | Next combo step (GCD) | Section 3. |
| 12 | Enhanced Piercing Talon | Only while `ENHANCED_PIERCING_TALON` is up. Below the combo step. |
| 13 | Life Surge held for burst | Low rank, reason "hold for burst". |

Cooldown oGCDs are never held or aligned: they rank high whenever available. No burst window is
defined; any burst check uses the currently active buffs.

Follow-ups (take the parent's slot):

| Parent just pressed | Follow-up | Engine marker / timer |
|---------------------|-----------|-----------------------|
| Geirskogul | Nastrond (one use per Geirskogul; the 2 s cooldown is a leftover of the old 3 uses) | `NASTROND_READY`, 20 s |
| High Jump | Mirage Dive | `DIVE_READY`, 15.46 s |
| Dragonfire Dive | Rise of the Dragon | `DRAGONS_FLIGHT`, 30.79 s |
| Stardiver | Starcross (needs Life of the Dragon) | `STARCROSS_READY`, 20 s |
| Drakesbane / Coerthan Torment | Raiden Thrust / Draconian Fury replace True Thrust / Doom Spike | `DRACONIAN_FIRE`, 30 s |

Mirage Dive is a normal damaging oGCD, not a utility action. Elusive Jump and Winged Glide are
never recommended; Plain Piercing Talon is not recommended either (the user adds it from the
menu). Using Elusive Jump enables row 12.

## 6. Life Surge

Recommended only when all hold: a charge is available, a slot is free, the **GCD the recommender
would suggest next** is eligible, and the budget is not spent.

- **Eligible GCDs.** Heavens' Thrust and Drakesbane when Lance Charge and Life of the Dragon are
  both active. Chaotic Spring only when Lance Charge, Life of the Dragon and Battle Litany are
  all active. At >= 3 targets, Coerthan Torment under the Heavens' Thrust / Drakesbane
  conditions (assumption: user said "only Coerthan Torment"; buffs for it not discussed). Nothing
  else (Wheeling Thrust, Lance Barrage and Fang and Claw are manual).
- **Fully buffed** = Lance Charge + Life of the Dragon + Battle Litany. Power Surge is not part
  of it (assumed always up). Battle Litany makes it an even-minute burst only.
- **Budget.** 1 charge in an odd burst, 2 in an even burst. A burst is even if Battle Litany is
  active or off cooldown. Counted from the history: Life Surges pressed since the last Lance
  Charge. Not counted from charges alone.
- **Fallback.** If higher-priority oGCDs took the slots before Heavens' Thrust / Drakesbane, the
  recommendation moves to the next eligible GCD. This is why Chaotic Spring is allowed when fully
  buffed.
- Outside the conditions, a held charge is listed at row 13, "hold for burst".

## 7. Non-goals (v1)

Raid buffs and potions, openers (presets), multi-target damage, positional play, triple-weaving
(until Evercold specifics), level other than 100, advice that depends on holding resources for a
particular raid-buff window, Power Surge or Draconian Fire upkeep, Life Surge cap guard.

## 8. Open points

- **Target-count setting:** done in session 4 (`RotationDocument.targetCount`, schema 3), shared
  with Viper. The shared interface is in `src/RotationLab/recommend/context.ts`.
- Recommendation rules are advice, not simulation: version them per job and ruleset in their own
  docs. No `AVAILABLE_RULESETS` bump for them.
- **Build order:** one shared recommender interface (state, history, target count -> ranked list),
  Viper ruleset first, then Dragoon on the same interface, one file per job.
- **Golden test:** the user supplies one opener plus a 2-minute cycle (as a preset or a list).
  A replay test checks that the top entry equals the next action pressed, with deliberate
  deviations listed (pre-pull Piercing Talon, positionals). Don't invent an opener from memory.
- Life Surge on Coerthan Torment at >= 3 targets is the one rule taken without a verified
  reason; confirm with the user when it comes up in a test.
- Stardiver's "< 5 s of Life of the Dragon" boost was my addition; the user accepted the table.
