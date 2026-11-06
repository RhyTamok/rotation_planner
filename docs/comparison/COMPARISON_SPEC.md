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
a "maximum achievable uses" optimizer (amended by Q9: overcap and missed uses are now shown as observed counts); converting leftover resources into damage; Git-like
version control; an archival platform; new engine formulas.

## 2. Locked decisions

### 2.1 Modes

Superseded on 2026-11-05 (roadmap C4): there is no mode field, and the `kind` field in section 3 is
dropped. Fight-specific analysis is implied by custom timeframes. The two uses it describes remain:

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
-   Window totals use `(start, end]`, matching cutoffs (decided, Q1): a hit exactly at `start` belongs to
    the previous window and a hit exactly at `end` to this one, so adjacent windows never double count.
    `totalBetween` implements this (roadmap M0). Exception: the pull hit has no previous window, so it
    belongs to a window starting at 0 s and not to one ending there (decided, Q1).
-   Times within 1e-6 s count as the same instant, because simulated times carry float noise (decided,
    Q1). This applies to cutoffs, windows and gauges in `compare.ts`.

### 2.3 Views

A. Difference-over-time graph: `deltaDPS(t)` per non-baseline configuration, with downtime, burst
and cutoff markers. B. Cutoff table: DPS, absolute and % difference, rank. C. Burst table: raid-buffed damage per
shared window versus the baseline (a manual comparison aid). D. Leftover-resource indicators at cutoffs
(neutral styling: no "good/bad" colors, no wasted/lost wording). E. Downtime and drift analysis.
Layout is undecided; only these contents are agreed.

### 2.4 Burst analysis

-   Windows are defined **once per comparison**, shared by all configurations, free-form (not 2 min).
-   The burst table reports expected damage per window, with the scenario's raid buffs applied as
    simulated. Raid buffs are not treated as neutral between configurations: different damage
    distributions benefit differently.

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
	id: string;
	revision: number;
	job: ShellJob;
	kind: "general" | "fightSpecific"; // [P] kind
	baselineConfigId: string; // [P] changing it never reruns a simulation
	cutoffs: number[];
	cutoffPresetId?: string; // [A] re-aggregation only, no rerun
	scenario: {
		level;
		partyBonus;
		countdown;
		fps;
		tinctureGrade;
		end: "settled"; // [S]
		partyBuffs: PartyBuffWindow[];
		downtime: DowntimeWindow[];
	};
	burstWindows: { start: number; end: number; label?: string }[]; // [A]
	driftCooldowns?: ActionKey[]; // [A]
	display: { colors?; visibleSeries?; activeTab? }; // [P]
}
// Layer B: one per configuration, a frozen copy (never only a reference)
interface ConfigurationDefinition {
	id: string;
	label: string;
	steps: RotationStep[]; // exact replay input, from RotationDocument.entries
	targets: TargetRange[];
	stats: ResolvedGear; // complete numeric stats + weaponDelay, as simulated
	gearRef?: { id?: string; name?: string }; // informational, never used to reproduce
}
// Layer C: execution record
interface SimulationExecution {
	ruleset: Ruleset;
	engineVersion: string;
	formulaVersion?: string;
	settings: { end: "settled" };
	simulatedAt: string;
	inputFingerprint: string;
	resultFingerprint: string; // SHA-256 hex
}
```

Dependency classes (derived from the code, see audit):

| Change                                                                                        | Needs                                                            | Why                            |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| Steps, targets, stats/weapon delay, scenario fight conditions, party buffs, downtime, ruleset | **Simulation rerun** for the affected configuration only         | These form `simulationKey()`   |
| Baseline, cutoffs, cutoff preset, burst windows, drift cooldown selection, comparison metric  | **Re-aggregation** from stored `DamageEvent`s and action records | Pure functions of the timeline |
| Colors, visible series, tab, layout                                                           | **UI only**                                                      | Not in any fingerprint         |

Caveat: drift needs per-use cooldown data (`readyAt`) that the result does not carry today (audit
2.9). That extends `RotationResult`, so it changes the result fingerprint, not the input fingerprint.

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
    **an engine version identifier does not** and is a prerequisite (Q3, decided: hand-bumped constant). Never read git at runtime.
-   **Snapshot lifecycle:** a working comparison is editable and carries `revision`. "Save snapshot"
    writes an immutable record (definition + frozen configurations + execution + stored results).
    Editing afterward bumps the working revision; the snapshot is never rewritten. No branching or diffs.
-   **Result states** (computed, never stored as a flag, so they cannot go stale themselves):
    -   _Current:_ stored `inputFingerprint` equals the fingerprint of the inputs now, and
        ruleset/engine equal the running build's.
    -   _Stale:_ the working comparison's inputs changed since its displayed results.
    -   _Historical:_ the snapshot's ruleset or engine differs from the running build. Numbers are shown
        as stored, labelled by their ruleset; never silently recomputed.
    -   _Unverified:_ the original engine is unavailable and the result fingerprint cannot be
        re-established (or a stored fingerprint fails to match its payload).
-   **UI:** one small line under the title: ruleset/version, configuration count, revision, state;
    expandable details with fingerprints and settings.
-   **Reproduction beyond the running build:** an engine identifier alone cannot reproduce results.
    MVP-sized options: keep the stored results as the authoritative record; record the source commit and
    a tag in the repository for every ruleset bump (`git tag ruleset/<version>`); optionally keep a
    built copy of old releases. Anything beyond is out of scope.
-   **Persistence:** reuse `parseWorkspace`/migration/validation patterns. Snapshots with stored events
    can be large; localStorage (about 5 MB) is probably insufficient and IndexedDB is the store (Q5, decided). The JSON snapshot file carries `schemaVersion`, is validated on import (type, size and range
    checks, no code execution, reject unknown future schema versions), and imported snapshots are
    labelled by their own ruleset and engine.

## 5. Acceptance criteria (feature-level)

1. Two to four configurations compare under one scenario; exactly one baseline is shown prominently.
   One configuration is also allowed, with comparison metrics disabled (roadmap C3).
2. Per cutoff: absolute DPS per configuration, `deltaDPS`, `deltaPct`, rank; baseline = 0.
3. Changing the baseline performs no simulation (provable by a spy on the simulator).
4. Table, chart and CSV agree to the last digit for every cutoff, with boundary hits attributed
   identically.
5. Burst table shows raid-buffed damage per shared window with baseline-relative values; adjacent
   windows never double count a boundary hit.
6. Leftover resources appear with neutral wording and no derived damage.
7. A saved snapshot reproduces its numbers after a ruleset bump, is labelled Historical, and is never
   mutated; a re-export/import round trip preserves inputs and results.
8. Malformed snapshot files are rejected with a message and never touch the workspace.
9. Existing engine parity and encounter tests still pass unchanged.

## 6. Questions and decisions

Decided by the user on 2026-11-04:

-   **Q1 Window boundaries:** match cutoffs, i.e. `(start, end]`. Added after M0, once real landing
    times showed float noise: comparisons use a small time tolerance, and a window starting at 0 s
    includes the pull hit.
-   **Q3 Engine version:** delegated to us. Decision (coding grounds): a hand-bumped `ENGINE_VERSION`
    string constant beside `AVAILABLE_RULESETS`, bumped whenever simulation code, damage formulas or game
    data change. Rationale: deterministic, visible in review, works in tests and any build; a build-time id
    adds tooling and cannot tell a comment-only change from a numeric one. A build id may be added later as
    informational metadata only.
-   **Q4 Downtime instants:**
    -   Entering downtime (start `D`): the existing `gaugesAt` semantics, i.e. the state after the last
        action pressed at or before `D` (snapshot at the end of that action's animation lock).
    -   Exiting (end `E`): the state at `E` (read with the same function; no action needing a target can
        be pressed inside downtime, so this is the state the downtime left behind).
    -   Relative DPS gap: `deltaDPS(D)` and `deltaDPS(E)`, both measured from the pull as in 2.2.
-   **Q5 Snapshot storage:** IndexedDB for saved snapshots, `localStorage` stays for the live workspace.
    Snapshots sit behind a small store interface (in-memory store in tests). Every snapshot can also be
    exported as a JSON file, which is the durable copy.
-   **Q7 Cutoff presets:** decided on 2026-11-06: the default cutoffs are every 30 s, plus the end of
    the fight. They are editable per comparison. No other presets or per-ruleset values exist yet.
-   **Q8 Scenario:** configurations may differ in rotation and gear, but all share one scenario.
-   **Q6 Drift** (all decided; seconds held, per interval):
    -   Tracked skills. Viper: Serpent's Ire; Vicewinder and Vicepit. Dragoon: Lance Charge,
        Geirskogul, Battle Litany, High Jump, Dragonfire Dive. Every tracked skill gets the same
        treatment; there is no special rule for Lance Charge or Battle Litany for now.
    -   "Overcap" is not a gauge metric. For stack skills it means a recharge going unused: the skill
        sits at maximum stacks, so spending a stack before downtime avoids it and loses no stack.
    -   Stack skills (Q6a): held seconds = time spent at maximum stacks, excluding untargetable time.
        Single-use skills: the wait between ready and press. Vicewinder and Vicepit share a cooldown
        (confirmed by the user), so they are evaluated as **one pool**, not per skill. The engine's
        cooldown group should be checked when implementing to confirm that matches.
    -   Attribution (Q6b): the hold clock runs from `max(readyAt, end of any downtime containing
readyAt)` to the press (for stack skills, over the capped stretch), minus every downtime second
        it spans. Hold seconds belong to the interval containing each second, where intervals are the
        stretches between downtime windows (plus optional manual boundaries). A skill that is ready
        during downtime is never reported as held for it.

Decided by the user on 2026-11-05 (amends Q6 and 2.5):

-   **Q9 Overcap and missed uses are shown.** Gauge overcap and missed uses of tracked skills are reported
    per configuration, in addition to leftover gauges and held seconds. This supersedes "overcap is not a
    gauge metric" (Q6) and "report held time, not a recast ceiling" (2.5). Still excluded: converting
    anything into damage or DPS, and a theoretical-maximum optimizer. Counts are observed from the
    simulated timeline only. Exact definitions are settled in M6 (proposal: gauge overcap = gain discarded
    above the cap, per gauge, recorded by the simulator; missed use = a recharge or cooldown that went
    unused because the skill sat at maximum stacks, or a use that never happened before the end of the
    fight, derived from `readyAt`). Neutral wording rules for leftovers (2.5) are unchanged.

No further open questions remain except Q9's definitions. Details found during implementation (for example the engine's cooldown
groups) are recorded in the handoff.
