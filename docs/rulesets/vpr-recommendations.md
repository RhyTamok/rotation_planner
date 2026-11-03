# Viper action recommendation ruleset (draft v1)

Status: design agreed with the user (grilling session, 2026-11-03). Not implemented. The next step
is to turn each table row into a Vitest case. Dragoon gets its own file with the same structure.

## 1. Purpose and output

A recommender takes the simulation state after the last pressed action and returns **one ranked
list** of actions (GCDs and oGCDs together). Each entry has `action`, `rank` and `reason`.

- Phase 1 (debugging): show the whole ranked list with reasons.
- Phase 2: show only the best entry; the list stays available.
- **Two layers:** (1) *legality* = what can be pressed now (engine `validateAttempt`, combo state,
  encounter rules); (2) *priority* = this document. Priority only ranks what legality returns, and
  it never removes an action. Every legal action stays usable by clicking elsewhere.
- A "follow-up replaces its dependency": once a parent action is pressed, its follow-up takes
  the parent's slot in the list (e.g. First Generation -> First Legacy, Hunter's Coil -> Twinblood).
- Encounter rules (handoff section 6) filter the list. A filtered entry is kept for debugging
  with a reason ("needs a target").
- Positionals are ignored. Honed/finisher buffs already choose the right action in the engine
  (`replaceIf`, `highlightIf`); the recommender uses the engine's replaced action.

## 2. Inputs

Last combo step (`VPR_COMBO`, `VPR_AOE_COMBO`, 30 s timers), `HUNTERS_INSTINCT` and `SWIFTSCALED`
(40 s), `SERPENT_OFFERINGS` (cap 100), `RATTLING_COIL` (cap 3), `cd_VICEWINDER` (2 charges, 40 s),
`cd_SERPENTS_IRE`, `READY_TO_REAWAKEN`, `REAWAKENED`, `REAWAKEN_COMBO`, `ANGUINE_TRIBUTE`,
pending follow-up statuses (section 5), encounter rules, and the scenario/rotation **target
count** setting.

**Family choice:** the rotation gets a target-count setting (does not exist yet; per rotation, default 1).
Targets >= 3 -> AoE variants (Vicepit, Maw combo, Jagged/Bloodied Maw, Dens, Last Lash).
Otherwise single target. Multi-target damage is not implemented; only the recommendation uses it.

## 3. Priority table (top = highest)

| # | Condition | Recommend | Reason string |
|---|-----------|-----------|---------------|
| 1 | Serpent's Ire off cooldown (and usable) | Serpent's Ire | "Ire ready" |
| 2 | A direct follow-up is pending (section 5) | The follow-up. Several pending: least buff time left first. | "follow-up of <parent>" |
| 3 | **Rule 0:** the combo timer would expire before the next planned step | The next combo step | "combo would time out" |
| 4 | **Rule 1:** Hunter's Instinct or Swiftscaled would expire before the next finisher | The finisher that refreshes the lower one (Hunter's -> Hunter's Sting / Coil; Swiftskin's -> Swiftskin's Sting / Coil) | "<buff> would expire" |
| 5a | Vicewinder/Vicepit has 2 charges, or the 2nd charge completes within 5 s | Vicewinder (ST) / Vicepit (AoE) | "charge cap" |
| 5b | `RATTLING_COIL` = 3 | Uncoiled Fury | "coil cap" |
| 5c | The next finisher (or Coil: +5) would push Offerings past 100, and Offerings >= 50 | Reawaken | "offering cap" |
| 6 | `READY_TO_REAWAKEN` | Reawaken | "Ready to Reawaken" |
| 7 | Offerings >= 50 | Reawaken | "available, not urgent" |
| 8 | Vicewinder/Vicepit has a charge, outside the burst window (section 4) | Vicewinder / Vicepit | "on cooldown outside burst" |
| 9 | Otherwise | The next dual-wield combo step (fangs -> sting -> finisher, or the Maw chain for AoE) | "combo step" |
| 10 | `RATTLING_COIL` >= 1 | Uncoiled Fury | "spend coil" |

Notes:

- Rules 3 and 4 outrank Reawaken (6, 7) and the cap guards (5). Rule 4 is a ranking, not a hard
  override; when it conflicts with an item, the higher row wins.
- The Hunter's/Swiftskin's Coil follow-up of Vicewinder/Vicepit is ranked with Vicewinder (rows 5a
  and 8), above the combo step, since it is the second half of the same ability.
- 7 is ranked "high": it is always listed at >= 50 Offerings, though saving up to 100 is
  legitimate (no guard other than 5c).
- Coils (10) have no rule beyond not overcapping (5b); the lowest priority by design.

### Rule 0 (combo timer)

"Next planned step" = the next GCD slot after any pending follow-up. If the remaining
`VPR_COMBO` / `VPR_AOE_COMBO` time is shorter than the time until the combo step could be pressed
if the recommender followed rows 5-8 first, the combo step jumps to row 3. Only the combo timer
counts here (not Honed buffs).

### Rule 1 (buff upkeep)

A buff is "at risk" if it would expire before the next finisher lands. The baseline is 3 GCDs per
cycle, adjusted by the current combo position (e.g. after the first step, 2 GCDs remain). Nothing
is refreshed early when the buff is not at risk.

## 4. Burst window

Start: Serpent's Ire cast. Anchor: the first Reawaken after that Ire that consumes
`READY_TO_REAWAKEN`. End: when `REAWAKENED` ends. Effect: only row 8 changes. Inside the window,
Vicewinder/Vicepit are recommended only through 5a (cap guard). Raid buffs are not part of the
definition. Tests may later change this.

## 5. Direct follow-ups (take the parent's slot, priority row 2)

| Parent (just pressed) | Follow-up | Engine marker |
|-----------------------|-----------|---------------|
| Reawaken | First Generation (GCD) -> First Legacy (oGCD) -> Second Generation -> Second Legacy -> Third Generation -> Third Legacy -> Fourth Generation -> Fourth Legacy -> Ouroboros | `REAWAKEN_COMBO`, `LEGACY_READY`, `ANGUINE_TRIBUTE` |
| Hunter's Coil / Swiftskin's Coil | Twinblood / Twinfang oGCD | `COIL_OGCD_READY`, `HUNTERS_VENOM`, `SWIFTSKINS_VENOM` |
| Uncoiled Fury | Twinfang / Twinblood oGCD | `UNCOILED_OGCD_READY`, `POISED_FOR_TWINFANG/BLOOD` |
| Hunter's Den / Swiftskin's Den | Den oGCDs (Twinfang/Twinblood Thresh) | `DEN_OGCD_READY` |
| Single-target finisher | Death Rattle (oGCD) | `DEATH_RATTLE_READY` (assumption, not discussed) |
| AoE finisher | Last Lash (oGCD) | `LAST_LASH_READY` (assumption, not discussed) |

While Reawakened, the Reawaken sequence entries fill the list (they are the pending follow-ups);
only Serpent's Ire (row 1) ranks above them.
The engine's replace chain (`replaceIf`) is authoritative for which twin/Den variant is next.

## 6. Non-goals (v1)

Raid buffs and potions, fixed openers (done with presets; an empty rotation or pre-pull just
gets "start the combo"), multi-target damage, positional play, advice that depends on holding
resources for a particular raid-buff window.

## 7. Open points

- Death Rattle / Last Lash handling (section 5) was inferred from the engine, not agreed with the user.
- Check which Vicewinder charge counts as "close to capping" when a Coil follow-up is pending.
- Rule 0 "next planned step" timing needs a precise definition when the code is written.
- Target-count setting must be added to the rotation model (schema bump + migration).
