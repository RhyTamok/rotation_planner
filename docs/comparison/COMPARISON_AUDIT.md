# Comparison system: codebase audit

Audited 2026-11-04 against branch `feature/rotation-lab` (HEAD `2dd8b467`) by static inspection only.
No tests were run for this audit and no production code was changed. Everything below is
**verified from source** unless marked *(unverified)*. Requirements are the locked decisions in
[COMPARISON_SPEC.md](COMPARISON_SPEC.md); the plan that follows from this audit is
[COMPARISON_ROADMAP.md](COMPARISON_ROADMAP.md).

Status key: **Implemented**, **Partial**, **Missing**, **Conflicting**, **Unverified**.

## 1. What exists today

A two-rotation comparison, `ui/ComparisonView.tsx`, over pure maths in `comparison/compare.ts`.

-   Two pickers (A, B) over the workspace's rotations. The pair lives in React `useState`, not in
    the workspace.
-   Each rotation is simulated with its own gear (`resolveGear`) under one shared
    `ScenarioDocument`, through `SimulationCache` (`simulation/SimulationManager.ts`).
-   `compareRotations()` builds one `CumulativeSeries` per result from `RotationResult.damageEvents`
    and derives everything else (cutoff rows, lead changes, burst-window totals) from those series.
    Cutoffs, chart start and baseline-less A/B are UI state; none is persisted.
-   Charts: running DPS (A, B) and running-DPS lead (`dpsA − dpsB`) sampled every whole second from
    "Charts from" (default 10 s). Burst windows are shaded and cutoffs dashed.
-   Cutoff table: totals, DPS, gauges. Burst table: damage per window (not weighted potency).

## 2. Engine semantics that the comparison must reuse (requirement 2.3)

| Topic | Actual behavior | Source |
| --- | --- | --- |
| Time axis | Display time in seconds, 0 = pull, negative = countdown. Floats, no integer ticks. | `simulation/types.ts` header |
| Pull | With `encounterRules`, the first damaging hit lands at exactly 0 s; the countdown is lengthened instead. | `rules/encounterRules.ts`, `RotationSimulator.ts` (~l. 528) |
| Damage timestamp | `DamageEvent.time = Potency.applicationTime`, i.e. when the hit lands (DoT ticks have their own event). | `RotationSimulator.ts` `result()` ~l. 477 |
| Downtime hit | `hitTarget = p.hasHitBoss(untargetable)`; a hit landing in downtime has `hitTarget: false` and zero damage. `DowntimeWindow.end` is exclusive. Effects still apply ("ghosting"). | `Potency.ts` l. 1020, `types.ts` |
| Simulation stop | `end: "lastAction" \| "settled" \| number`. A number ticks the clock to that time; hits not landed by then are *pending* and have no `DamageEvent`. `"settled"` waits for all landing (capped by `MAX_SETTLE_SECONDS`). | `RotationSimulator.ts` `finish()` l. 299 |
| Result total | `damage.expectedDamage` = landed hits; `expectedDps = expectedDamage / endTime`, `endTime` = display time at stop, measured from 0 (downtime counts). | `#damageTotals` l. 392 |
| Cutoff total | `totalAt(series, t)` sums events with `time <= t` (**inclusive**). A hit landing exactly at `t` counts. Events after `t` (including later DoT ticks) contribute 0. | `compare.ts` `totalAt`, `lastIndex` |
| Cutoff DPS | `dpsAt = totalAt(t) / t`, undefined for `t <= 0`. Elapsed time includes downtime. | `compare.ts` `dpsAt` |
| Window total | `totalBetween(start, end)`: both ends **inclusive** (test `rotationLabCompare.test.ts` l. 69). | `compare.ts` |
| Party buff window | Active for `time <= t <= time + duration` (inclusive both ends), snapshot at press. | `GameState.getPartyBuffs`, handoff §5 |

Findings on these semantics:

-   **Cutoff aggregation matches the engine's landing semantics.** Because `damageEvents` only holds
    landed hits and `totalAt` filters by landing time, "damage counts when it lands" and "periodic
    damage after a cutoff contributes zero" hold for a `"settled"` run. *Status: Implemented for the
    table and charts.* Viper has no DoT, so the DoT-after-cutoff case is **untested** (needs Dragoon).
-   **A single `"settled"` simulation serves every cutoff.** Cutoffs are extracted from the timeline,
    not re-simulated. The simulation is only a function of scenario, gear, steps and ruleset. A
    numeric `end` instead truncates the engine and would make a later cutoff wrong, because pending
    damage has no event. *Recommendation:* fix comparisons to `"settled"` and treat a cutoff beyond
    the last landed hit as a flat total (it already is, mathematically).
-   **Window boundary double count (discrepancy, unresolved).** `totalBetween` includes both ends, so
    two touching windows `[a,b]` and `[b,c]` count a hit landing at exactly `b` twice. Cutoffs use
    `<= t`, which is consistent with a window `(start, end]`, not `[start, end]`. A decision is needed
    (spec §6, question Q1). Not changed.
-   **Cutoff beyond one result's own end *(unverified)*.** The view sets `endTime = max(endA, endB)`.
    For `"lastAction"` scenarios the shorter result may still have pending hits that never become
    events, so its DPS at later cutoffs is understated. The scenario's default end is `"settled"`
    (`createScenario`), so this only bites when the user picks `"lastAction"` or a number.
-   **Gauges at a cutoff are approximate.** `gaugesAt` returns the snapshot of the last action
    *pressed* at or before `t`, taken at the end of that action's animation lock (which can be after
    `t`). It is not a state at exactly `t`. Acceptable for Viper (no passive gauge changes), an
    indicator-only violation risk for jobs with decaying resources. *Status: Partial.*

## 3. Requirement-by-requirement

### 2.1 Configuration = rotation + gearset + stats

-   **Status: Partial.** `RotationDocument` carries `gearSetId` and `gearOverrides`; `resolveGear()`
    returns `ResolvedGear` (`GearStats` main/wd/crit/DH/det/SKS/tenacity plus `weaponDelay`). Gear sets
    may differ per rotation, so the comparison already compares combined configurations.
-   **Gap:** no "configuration" entity. The pair is `useState` in `ComparisonView`. The gear is
    referenced by id, so editing or deleting the gear set silently changes (or resets to job defaults,
    see `resolveGear`) a later view. Speed is an *outcome*: the GCD derives from `skillSpeed` inside
    the engine; there is no stored GCD value, only a display in `GearPanel`.
-   **Next:** introduce a stored configuration reference (id, rotation id, gear set id) in a comparison
    document; resolve to a frozen copy at snapshot time.

### 2.2 Comparison modes (general / fight-specific)

-   **Status: Missing** as modes. Free-form cutoffs exist (`extraCutoffs` state, "At cutoffs" table).
    No presets, no per-ruleset presets, no sweep table. A 1 s DPS sweep for charts exists
    (`sampleTimes`, `dpsSamples`).
-   Downtime as a simulation input **exists**: `ScenarioDocument.downtime` (`DowntimeWindow[]`,
    fixed timestamps), validated in `models/validation.ts`, editable in `ScenarioPanel`. *Implemented
    as an input*, not as a comparison feature.

### 2.3 Cutoff semantics

-   **Status: Implemented** in the engine and `compare.ts` (section 2), with the gaps listed there:
    window-boundary inclusivity, DoT test gap, per-result end handling, no documented-and-tested
    single source of truth shared with exports (there are no exports yet).

### 2.4 DPS difference over time

-   **Status: Partial.** The "DPS lead" chart plots `dpsA − dpsB` from `dpsSamples`, which matches the
    required `deltaDPS_i(t) = DPS_i(t) − DPS_b(t)` for exactly two configurations, with A fixed as the
    minuend.
-   **Gaps:** no baseline concept, fixed to two series, samples only at whole seconds from `from`
    (cutoffs between samples are not plotted exactly, and the step-function nature of `totalAt` is
    thinned), downtime markers not drawn *(unverified: the chart receives `windows` and `cutoffs` only)*.
-   **Naming trap:** `differenceSeries`/`leadChanges` operate on *cumulative damage* difference. Since
    `DPS_a(t) − DPS_b(t) = (T_a(t) − T_b(t)) / t` and `t > 0`, the **sign** (hence lead changes and
    ranking reversals) is identical, but the magnitudes differ. The primary metric must be the DPS
    form; `differenceSeries` should stay internal or be renamed when generalized.

### 2.5 Baseline

-   **Status: Missing.** A is implicitly the minuend; there is no designated baseline, no percentage
    difference anywhere. Baseline switching need not resimulate: all results are `SimulationCache`
    entries keyed by `simulationKey()` and the baseline is not part of that key (good, reusable as is).

### 2.6 Burst analysis, weighted potency, raid buffs

-   **Status: Partial.** Shared burst windows exist: `ScenarioDocument.burstWindows` (manual, "not a
    simulation input") or derived by merging party buffs (`burstWindows()` in `compare.ts`). They are
    per scenario, hence shared by every compared rotation. Not tied to 2-minute cycles. The raid buff
    schedule is also a scenario input (`partyBuffs: PartyBuffWindow[]`).
-   **Actual behavior of the numbers:**
    -   `DamageEvent.potency` = `Potency.getAmount({includePartyBuffs: true, tincturePotencyMultiplier,
        bossDebuffsOnPrimaryOnly: true})`: it **includes** party buffs and the flat potion multiplier. It is
        not weighted potency.
    -   `expectedDamage` is the xivgear-style chain (`DamageModel`) with party buffs as a ratio on top
        (`#expectedDamage`, l. 340).
    -   `totals.appliedPotencyWithoutPot` excludes potion **and** party buffs but keeps self buffs, as a
        single total only (no per-event, no per-window).
    -   The burst table reports `totalBetween` of the chosen metric (damage if available, otherwise
        potency), i.e. **raid-buffed damage**. It does not report weighted potency.
-   **Gap:** no `rawPotency × selfBuffMultipliers × fixedJobModifiers` series. `Potency` exposes
    `getDisplayedModifiers()` with `source` and `kind` (`PotencyModifierType`), which likely allows
    separating self buffs from party buffs and potion per event. *(Unverified: whether every self
    buff is a `Potency` modifier or part of the base.)* "Fixed job modifiers" has no counterpart in
    the engine (jobmod lives in `DamageModel`).
-   **Ambiguity to resolve (Q2):** whether "fixed job modifiers" means jobmod/trait constants from
    `DamageModel` and whether crit/DH expectation is in or out of weighted potency.

### 2.7 Leftover resources

-   **Status: Partial.** `gaugesAt` + the gauge columns in the cutoff table, from `rules/resourceTracking.ts`
    (`GaugeValue[]`; VPR gauges only; DRG tracking not implemented). Shown as plain numbers with no
    "wasted" or "good" styling found *(visual review not performed)*. No conversion into damage in
    the code.

### 2.8 Downtime analysis

-   **Status: Missing** as analysis. Inputs exist (`downtime`). There is no "entering/exiting"
    extraction, no pre/post DPS gap. Gauges at an instant are available only through `gaugesAt`
    (approximate, section 2). Cooldown state is not tracked at all (next item).

### 2.9 Cooldown drift (held time)

-   **Status: Missing.** `resourceTracking.ts` tracks gauges, buff timers and combo timers only.
    The engine knows cooldowns (`CoolDown`, `GameState.cooldowns`, `timeTillReady` on resources) but
    the recorder does not snapshot them, and `SimulatedAction` has no per-action "ready since"
    field. `gcdDelay`/`clipped` exist for GCDs only.
-   **Untargetable handling for drift:** the engine models downtime as a timeline mask
    (`host.timeline.duringUntargetable`) plus the Lab's downtime rule; no cooldown logic depends on
    it. Held time = (press time − ready time) minus the overlap with downtime windows is computable
    from a per-use `readyAt`, which needs recording.
-   **Not to be built:** a "maximum achievable uses" optimizer (spec non-goals).

### 2.10 Views A–E

| View | Status | Notes |
| --- | --- | --- |
| A Difference graph | Partial | Two configs, no baseline, no downtime markers (unverified), burst and cutoff markers exist |
| B Cutoff table | Partial | DPS and totals for A/B; no % vs baseline, no ranking, no 3–4 configs |
| C Burst table | Partial | Raid-buffed damage per window; no weighted potency |
| D Leftover resources | Partial | Gauges in cutoff table (see 2.7) |
| E Downtime and drift | Missing | |

### 2.11 Import / export

-   **Status: Missing for CSV.** Grep for `csv` in `src/RotationLab`, `vite.config`, `package.json`
    finds nothing. Exists: whole-workspace JSON export/import (`serializeWorkspace`, `parseWorkspace`,
    migrations, per-document validation in `models/validation.ts`) and xivgear gear import
    (`import/xivgear.ts`). Upstream XIV in the Shell has its own timeline file format; it is not wired
    to the Lab's rotations *(unverified whether Lab can import it; `RotationStep` supports `targets`
    "from upstream imports")*.

### 3 Provenance

| Item | Exists? | Detail |
| --- | --- | --- |
| Ruleset version | **Yes** | `AVAILABLE_RULESETS` (`reborn-dt-2`), `RotationDocument.ruleset`. Hand-bumped; `simulateDocument` returns `rulesetMismatch` instead of recalculating under the saved rules (it recalculates under the **current** rules and only flags it). |
| Schema version | **Yes** | `SCHEMA_VERSION = 4`, `storage/migrations.ts`, backups under `rotationLab.workspace.v<old>` |
| Engine/source version | **No** | `package.json` version is the upstream `0.1.0`; no build-time commit injection in `vite.config.ts`; git is not on PATH at runtime anyway. A hand-maintained `ENGINE_VERSION` constant or a Vite `define` of a build id are the options. Do not fabricate: until added, record `unknown`. |
| Formula versioning | **No** | `damage/DamageModel.ts` has no version; today it is covered by the ruleset bump rule |
| Input canonicalization | **Partial** | `stableStringify` and `simulationKey()` already define the exact set of simulation inputs (job, ruleset, steps, merged options) and exclude names/ids/timestamps |
| Hashing | **Missing** | Cache key is the canonical string itself; no SHA-256. `crypto.subtle` is available in the browser on `localhost`/https; `crypto.randomUUID` is already used (`newId`). Vitest/jsdom availability of `crypto.subtle` is *unverified*. |
| Result fingerprint | **Missing** | |
| Immutable snapshots / states | **Missing** | Saved documents are mutable; no result is ever stored (always recomputed on view) |
| Persistence layer | `localStorage` only | One JSON workspace under `rotationLab.workspace`. A snapshot with saved results may exceed the localStorage quota (about 5 MB); see roadmap risk R3 |

Important behavioral conflict with 3.4: **`simulateDocument` silently recalculates an old rotation
under the new ruleset** and only attaches `rulesetMismatch`. For a live editor that is right; for a
saved comparison it would violate "do not silently recalculate historical comparisons".
Snapshots therefore must store results, not just inputs.

### Tests available

`src/__test__/rotationLabCompare.test.ts` (pure maths and a real-rotation total parity check),
`rotationLabSimulator/Encounter/EncounterRules/Targets/Damage/Workbook` (engine parity, pull and
downtime rules, workbook cross-check), `rotationLabPersistence.test.ts` (parse, migrate, backups),
`rotationLabIsolation/HostIsolation`. All can be extended in place; no new framework is needed.
Gaps: no UI-independent test for baseline math, per-cutoff boundary hits in a real simulation,
DoT-after-cutoff, 3–4 configurations, gear with different GCD speeds in one comparison, or any
export.

## 4. Verified vs recommended

Everything in sections 1–3 above the "Next/Recommendation" lines is read from source. The
recommendations are architecture advice for the roadmap and are not yet agreed beyond the locked
decisions.
