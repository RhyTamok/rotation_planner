# Comparison system specification (including provenance)

Status: **design, not implemented** except where marked. The locked decisions in section 2 were
agreed with the user; everything else is a proposal. Current state of the code:
[COMPARISON_AUDIT.md](COMPARISON_AUDIT.md). Build order: [COMPARISON_ROADMAP.md](COMPARISON_ROADMAP.md).
Project context: [../PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md).

Audience: expert FFXIV theorycrafters (Viper, later Dragoon) whose results may feed Balance
recommendations. No game-basics explanations.

## 1. Goals and scope

-   Compare 2–4 **configurations** of the **same job** (generally 2–3), one of them the **baseline**.
-   A configuration is one rotation + one gearset + its numerical stats and speed. Entries need not
    share a gearset: gearsets are optimized elsewhere per GCD speed, and different speeds may need
    different rotations.
-   A comparison measures the combined effect. It does not isolate rotation versus stats.
-   Deterministic expected damage only. Reuse the existing engine, timing and damage model.
-   Adaptable to Evolved (Evercold) and other rulesets without assuming future mechanics.

Non-goals: cross-job comparison; HP-based phases; RNG/Monte Carlo; standardized 2-minute cycles;
a "maximum/missed achievable uses" optimizer; converting leftover resources into damage; Git-like
version control; an archival platform; new engine formulas.

## 2. Locked decisions

### 2.1 Modes

-   **General:** DPS at standardized cutoff timestamps (adjustable presets, per ruleset), versus the
    baseline.
-   **Fight-specific:** a sweep of cutoffs and fixed-timestamp downtime intervals; ranking versus kill
    time; resource retention and cooldown behavior around downtime.

### 2.2 Definitions (must match the engine; see audit section 2)

-   Time: display seconds, 0 = pull. Damage counts when it **lands** (`DamageEvent.time`, `hitTarget`).
-   `Total_i(t)` = sum of expected damage of hits with `time <= t` (inclusive). Later periodic ticks add 0.
-   `DPS_i(t) = Total_i(t) / t` for `t > 0`, elapsed time includes downtime.
-   `deltaDPS_i(t) = DPS_i(t) − DPS_b(t)`; `deltaPct_i(t) = deltaDPS_i(t) / DPS_b(t)` (undefined if
    `DPS_b(t) = 0`); baseline rows are 0.
-   Ranking at a cutoff: configurations sorted by `DPS_i(t)` descending; ties share a rank.
-   One implementation (`comparison/compare.ts`) feeds the table, the chart and every export, so that
    boundaries cannot diverge. No alternative cutoff calculation.
-   Window total convention is **open** (Q1): the code currently uses `[start, end]`.

### 2.3 Views

A. Difference-over-time graph: `deltaDPS(t)` per non-baseline configuration, with downtime, burst
and cutoff markers. B. Cutoff table: DPS, absolute and % difference, rank. C. Burst table: weighted
potency per window, kept visibly separate from damage. D. Leftover-resource indicators at cutoffs
(neutral styling: no "good/bad" colors, no wasted/lost wording). E. Downtime and drift analysis.
Layout is undecided; only these contents are agreed.

### 2.4 Burst analysis

-   Windows are defined **once per comparison**, shared by all configurations, free-form (not 2 min).
-   `weightedPotency = rawPotency × selfBuffMultipliers × fixedJobModifiers`, party buffs excluded
    from this metric only. Raid buffs remain relevant to actual damage and may be applied over time
    intervals afterwards; because damage distributions differ, they are never dismissed as neutral.
-   Three quantities must never be conflated: weighted potency (self-buffed), raid-buffed damage,
    total DPS.

### 2.5 Leftover resources, downtime, drift

-   Gauges at a cutoff: indicators only. Never converted to damage, never described as inherently
    good or wasteful.
-   Downtime analysis (fixed timestamps only): gauges held entering downtime; gauges available leaving
    it; selected cooldown states entering/leaving; `deltaDPS` immediately before and after. Each value
    must state its instant exactly (see Q4).
-   Drift: hand-picked key cooldowns per job. Metric: **seconds held**, per fight interval. Untargetable
    time is excused; every other eligible second counts; no grace period. Report held time, not a
    recast ceiling.

### 2.6 Import and export (planned)

CSV: per-action timeline; per-cutoff summary; rotation import. JSON comparison snapshot (section 4).
CSV is analysis-only and not a reproducibility format.

## 3. Proposed data model (proposal)

Layered so that results can be recomputed (A, B) or merely inspected (C).

```ts
// Layer A: shared definition (simulation inputs marked [S], presentation marked [P])
interface ComparisonDefinition {
  id: string; revision: number; job: ShellJob; kind: "general" | "fightSpecific";   // [P] kind
  baselineConfigId: string;                          // [P] changing it never reruns a simulation
  cutoffs: number[]; cutoffPresetId?: string;        // [A] re-aggregation only, no rerun
  scenario: { level, partyBonus, countdown, fps, tinctureGrade, end: "settled",   // [S]
              partyBuffs: PartyBuffWindow[]; downtime: DowntimeWindow[] };
  burstWindows: { start: number; end: number; label?: string }[];                   // [A]
  driftCooldowns?: ActionKey[];                                                     // [A]
  display: { colors?, visibleSeries?, activeTab? };                                 // [P]
}
// Layer B: one per configuration, a frozen copy (never only a reference)
interface ConfigurationDefinition {
  id: string; label: string;
  steps: RotationStep[];                  // exact replay input, from RotationDocument.entries
  targets: TargetRange[];
  stats: ResolvedGear;                    // complete numeric stats + weaponDelay, as simulated
  gearRef?: { id?: string; name?: string };   // informational, never used to reproduce
}
// Layer C: execution record
interface SimulationExecution {
  ruleset: Ruleset; engineVersion: string; formulaVersion?: string;
  settings: { end: "settled" };  simulatedAt: string;
  inputFingerprint: string;  resultFingerprint: string;   // SHA-256 hex
}
```

Dependency classes (derived from the code, see audit):

| Change | Needs | Why |
| --- | --- | --- |
| Steps, targets, stats/weapon delay, scenario fight conditions, party buffs, downtime, ruleset | **Simulation rerun** for the affected configuration only | These form `simulationKey()` |
| Baseline, cutoffs, cutoff preset, burst windows, drift cooldown selection, comparison metric | **Re-aggregation** from stored `DamageEvent`s and action records | Pure functions of the timeline |
| Colors, visible series, tab, layout | **UI only** | Not in any fingerprint |

Caveat: burst-window weighted potency and drift need per-event/per-use data the result does not carry
today (audit 2.6, 2.9); those are extensions of `RotationResult`, so they change the result schema and
therefore the result fingerprint, not the input fingerprint.

## 4. Provenance

Principle: a saved comparison is a self-contained research artifact.

-   **Input fingerprint** = SHA-256 of `stableStringify` over, per configuration, exactly the
    `simulationKey()` inputs (job, ruleset, steps, merged options incl. targets), plus the engine
    identity. Names, ids, timestamps, baseline, cutoffs, burst windows and display settings excluded.
    Extend it with the aggregation inputs (cutoffs, windows) as a second hash if a "results" hash is
    wanted, so that re-aggregation never looks like a simulation change.
-   **Result fingerprint** = SHA-256 of the canonical serialization of the stored result payload
    (damage events, per-action records, derived summaries) with fixed number formatting.
-   **Version identifiers** (audit section 3): ruleset `reborn-dt-2` exists; schema version exists;
    **an engine version identifier does not** and is a prerequisite (Q3). Never read git at runtime.
-   **Snapshot lifecycle:** a working comparison is editable and carries `revision`. "Save snapshot"
    writes an immutable record (definition + frozen configurations + execution + stored results).
    Editing afterward bumps the working revision; the snapshot is never rewritten. No branching or diffs.
-   **Result states** (computed, never stored as a flag, so they cannot go stale themselves):
    -   *Current:* stored `inputFingerprint` equals the fingerprint of the inputs now, and
        ruleset/engine equal the running build's.
    -   *Stale:* the working comparison's inputs changed since its displayed results.
    -   *Historical:* the snapshot's ruleset or engine differs from the running build. Numbers are shown
        as stored, labelled by their ruleset; never silently recomputed.
    -   *Unverified:* the original engine is unavailable and the result fingerprint cannot be
        re-established (or a stored fingerprint fails to match its payload).
-   **UI:** one small line under the title: ruleset/version, configuration count, revision, state;
    expandable details with fingerprints and settings.
-   **Reproduction beyond the running build:** an engine identifier alone cannot reproduce results.
    MVP-sized options: keep the stored results as the authoritative record; record the source commit and
    a tag in the repository for every ruleset bump (`git tag ruleset/<version>`); optionally keep a
    built copy of old releases. Anything beyond is out of scope.
-   **Persistence:** reuse `parseWorkspace`/migration/validation patterns. Snapshots with stored events
    can be large; localStorage (about 5 MB) is probably insufficient and IndexedDB is the likely home
    (Q5). The JSON snapshot file carries `schemaVersion`, is validated on import (type, size and range
    checks, no code execution, reject unknown future schema versions), and imported snapshots are
    labelled by their own ruleset and engine.

## 5. Acceptance criteria (feature-level)

1. Two to four configurations compare under one scenario; exactly one baseline is shown prominently.
2. Per cutoff: absolute DPS per configuration, `deltaDPS`, `deltaPct`, rank; baseline = 0.
3. Changing the baseline performs no simulation (provable by a spy on the simulator).
4. Table, chart and CSV agree to the last digit for every cutoff, with boundary hits attributed
   identically.
5. Burst table shows weighted potency separately from raid-buffed damage; windows are shared.
6. Leftover resources appear with neutral wording and no derived damage.
7. A saved snapshot reproduces its numbers after a ruleset bump, is labelled Historical, and is never
   mutated; a re-export/import round trip preserves inputs and results.
8. Malformed snapshot files are rejected with a message and never touch the workspace.
9. Existing engine parity and encounter tests still pass unchanged.

## 6. Open questions (need a product decision)

-   **Q1** Window boundaries: `[start, end]` (current) double-counts a hit at a shared boundary;
    `(start, end]` matches cutoff semantics. Which?
-   **Q2** Weighted potency definition: what counts as "fixed job modifiers"; are crit/DH expectation
    and the potion included? Which self buffs count?
-   **Q3** Engine version: a hand-bumped `ENGINE_VERSION` constant next to `AVAILABLE_RULESETS`, a
    build-time id from Vite `define`, or both?
-   **Q4** Downtime instants: "entering" = state at the downtime start, or after the last action
    pressed before it? "Exiting" = at the end, or at the first usable action? Gauges at an instant are
    currently "after the last action pressed" (audit section 2).
-   **Q5** Snapshot storage: IndexedDB as the store for snapshots only, leaving the live workspace in
    localStorage?
-   **Q6** Which cooldowns are the "key" ones for Viper and Dragoon, and per-interval attribution
    rules for held time (per fight phase between downtimes?).
-   **Q7** Cutoff presets per ruleset: which values for Reborn?
-   **Q8** Should a comparison require identical `scenario.end`/party buffs, or may configurations
    differ in fight conditions? (Current design: one shared scenario.)
