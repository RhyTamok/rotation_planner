# Comparison system roadmap

Plan only; nothing here is implemented. Based on [COMPARISON_AUDIT.md](COMPARISON_AUDIT.md) and
[COMPARISON_SPEC.md](COMPARISON_SPEC.md). Effort: L / M / H. Each milestone should be one reviewable
commit series ending with `/verify-task`. Bump `AVAILABLE_RULESETS` only if a milestone changes
game data or mechanics (none planned); bump `SCHEMA_VERSION` with a migration whenever a stored
document shape changes (M1, M7).

## Decisions needed before starting

Q1 (window boundaries), Q2 (weighted potency), Q3 (engine version), Q5 (snapshot storage) from the spec
section 6. M0–M3 only need Q1; the others can wait for their milestone.

## Minimum viable comparison = M0 + M1 + M2 + M3

Why: the engine, caching and cutoff maths already exist, so the smallest valuable step is to
generalize them from "A vs B" to "N configurations vs a baseline" with correct, tested definitions.
It delivers views A and B (the primary question: who wins at which kill time) and needs no result
schema change, so it cannot disturb numerical correctness.

## M0 Pin the semantics (L)

-   **Objective:** make the cutoff/boundary rules executable before building on them.
-   **Reuse:** `totalAt`, `dpsAt`, `totalBetween`, `simulateRotation`, existing real-rotation parity test.
-   **Changes:** add tests only (plus the Q1 outcome in `totalBetween` if changed, with a visible note).
    Tests: a hit landing exactly at a cutoff counts; a hit 1 ms later does not; downtime hit counts 0;
    cutoff in downtime uses full elapsed time; window boundary per Q1; `lastAction` versus `settled`
    behavior for pending hits; DoT after cutoff once Dragoon exists (marked pending).
-   **Files:** `src/__test__/rotationLabCompare.test.ts`, `rotationLabEncounter.test.ts`.
-   **Depends on:** Q1. **Accept:** semantics table in the audit matches passing tests. **Risk:** Q1
    changes an existing assertion (test at l. 69): record it in the handoff, never silently.

## M1 Comparison document and configurations (M)

-   **Objective:** a stored comparison of 2–4 configurations with a baseline, replacing `useState` A/B.
-   **Reuse:** `RotationDocument`, `resolveGear`, `ScenarioDocument`, `SimulationCache`,
    `validation.ts`, `migrations.ts`, `setWorkspace`.
-   **Changes:** `models/Comparison.ts` (`ComparisonDocument`: id, name, job, scenarioId, configurations
    `[{id, rotationId}]`, baselineId, cutoffs, burstWindows, display); workspace gets `comparisons`
    (schema 5 + migration v4→v5 creating none); validation (2–4 entries, same job, baseline exists);
    undoable edits. Configurations still reference live rotations here; freezing is M7.
-   **Files:** `models/Comparison.ts`, `models/validation.ts`, `storage/WorkspaceStore.ts`,
    `storage/migrations.ts`, `ui/RotationLabApp.tsx`.
-   **Depends on:** none (Q8 answered "one shared scenario" for now). **Accept:** round trip through
    `parseWorkspace`; undo/redo works; invalid same-job/size rejected. **Tests:** persistence and
    migration tests extended. **Risk:** schema churn; keep the document small.

## M2 N-way baseline-relative maths (M)

-   **Objective:** pure functions for `deltaDPS`, `deltaPct`, rank, per cutoff and per sample time.
-   **Reuse:** `cumulativeSeries`, `totalAt`, `dpsAt`, `sampleTimes`, `dpsSamples`.
-   **Changes:** `comparison/baseline.ts`: `compareConfigurations(results, baselineId, cutoffs)` and
    `deltaDpsSeries`. Keep `compareRotations` as is until the UI moves, then retire it. Sample at every
    event time plus cutoffs, not only whole seconds, so extrema and cutoffs are exact (step function).
-   **Accept:** all definitions in spec 2.2; baseline row exactly 0; baseline switch gives identical
    per-configuration DPS; zero-DPS baseline yields undefined percent. **Tests:** hand-computed
    fixtures, 2/3/4 configurations, different GCD speeds (e.g. two gear sets with different skill
    speed), ranking reversal, no downtime and with downtime, parity with `result.damage.expectedDamage`,
    spy proving no resimulation on baseline change. **Risk:** low; effort pure maths.

## M3 Comparison UI: baseline, cutoff table, difference graph (M)

-   **Objective:** views A and B for N configurations.
-   **Reuse:** chart component and `rl-chart` styles in `ComparisonView.tsx`, `ScenarioPanel`.
-   **Changes:** configuration picker (add/remove, 2–4), baseline radio, cutoff presets (Q7) with
    editable list persisted in the comparison, table with abs/%/rank, difference chart with baseline at
    zero, downtime, burst and cutoff markers, colorblind-safe palette for 4 series. Split the 548-line
    view into components.
-   **Accept:** spec acceptance 1–4 (CSV part in M4). **Tests:** component tests for baseline switching
    and table contents; chart only visually reviewed by the user. **Risk:** chart clarity with 4 series;
    UI review is the user's.

## M4 CSV export (L)

-   **Objective:** per-action timeline and per-cutoff summary CSV, sharing M2's numbers.
-   **Changes:** `export/csv.ts` (pure, RFC 4180 quoting, fixed decimal format independent of locale
    since the UI is locale-formatted), download button. Per-action columns from `SimulatedAction`
    (times, lock end, GCD/oGCD, valid, notes, potency, damage, targets, gauges).
-   **Accept:** every CSV cutoff cell equals the table cell computed by the same function.
    **Tests:** golden CSV, quoting/locale, round trip against `compare.ts`. **Risk:** locale and
    spreadsheet formula injection in text cells (prefix `'` for cells starting with `= + - @`).

## M5 Burst analysis with weighted potency (M)

-   **Objective:** view C, separating weighted potency, raid-buffed damage and DPS.
-   **Reuse:** burst windows (scenario/comparison), `Potency.getDisplayedModifiers`, `DamageModel`.
-   **Changes:** extend `DamageEvent` with the self-buffed potency (modifier source split) per Q2;
    `comparison/burst.ts`; the burst table shows weighted potency per window and, in a separate column
    group, raid-buffed damage. Window boundary per Q1.
-   **Depends on:** Q2, M0. **Accept:** weighted potency excludes party buffs and the potion as
    defined; identical buff schedule with different damage distribution gives different raid-buffed
    totals; non-2-minute windows work. **Tests:** fixtures with a hand-built party-buff schedule,
    check against `appliedPotencyWithoutPot` where definitions coincide. **Risk:** ambiguity in what
    self buffs the engine encodes as modifiers; this changes the `RotationResult` shape (not the
    simulation), so the simulation key stays but the result fingerprint changes.

## M6 Resources, downtime and drift (H)

-   **Objective:** views D and E.
-   **Changes:** (a) exact-instant gauge extraction (Q4) in `resourceTracking`/`gaugesAt`;
    (b) record cooldown readiness per executed action (`readyAt`, from `CoolDown` state in the
    simulator, not new rules) for a per-job key cooldown list (Q6); (c) `comparison/drift.ts`: held
    seconds = Σ(press − ready) per use, minus overlap with downtime windows, attributed to intervals
    between downtimes; (d) downtime panel: gauges/cooldowns at entry and exit, `deltaDPS` immediately
    before and after, with instants labelled.
-   **Depends on:** Q4, Q6; M2. **Accept:** held time excludes untargetable seconds and has no grace
    period; no resource-to-damage conversion anywhere; neutral wording. **Tests:** simulated Viper
    rotations with and without a deliberate Reawaken/Serpent's Ire delay across a downtime window;
    drift per interval sums to the total; engine parity suites unchanged. **Risk:** touches the
    simulator's result recording (engine-adjacent); keep it read-only observation, rerun full parity.

## M7 Provenance and snapshots (H)

Introduce the **data types and fingerprint function early** (a small slice may be done right after M1,
because M1's document shape should leave room for it); full snapshots land here.

-   **Objective:** immutable, self-contained snapshots, result states, JSON export/import.
-   **Reuse:** `stableStringify`, `simulationKey` canonical inputs, `parseWorkspace`/migrations/
    validation patterns, `AVAILABLE_RULESETS`, `SCHEMA_VERSION`.
-   **Changes:** `ENGINE_VERSION` (Q3); `provenance/fingerprint.ts` (SHA-256 via `crypto.subtle`, async;
    canonical result serialization with fixed number formatting); `models/ComparisonSnapshot.ts`
    (frozen configurations with full `ResolvedGear`, stored results); `storage/SnapshotStore.ts`
    (IndexedDB per Q5, behind a small interface so tests use an in-memory store);
    `provenance/state.ts` (current/stale/historical/unverified as a pure function); snapshot validation
    with size/range limits and future-schema rejection; metadata line and details in the UI; tag
    convention `ruleset/<version>` in the handoff.
-   **Accept:** spec acceptance 7 and 8. **Tests:** identical inputs give identical fingerprints
    (also across key order and renamed documents); changing a stat, step or party buff changes it;
    changing the baseline, cutoffs, colors or tab does not change the input fingerprint; a snapshot
    keeps its numbers after a simulated ruleset bump and reads Historical; corrupt, oversized,
    wrong-type, future-schema and tampered-fingerprint files rejected; export/import round trip.
    **Risk:** `crypto.subtle` is async and unavailable on insecure origins other than localhost
    (verify in Vitest/jsdom first); float serialization must be canonical; IndexedDB quota and
    eviction (offer export as the durable path); the reproduction promise is bounded by stored
    results, not by rerunning an old engine.

## M8 CSV rotation import and polish (M)

Rotation CSV import (validated against `ActionKey`, bounded size, rejects unknown actions), preset
management, snapshot list UI, optional revision diffs. Do after the others; the format needs a Q.

## Ordering notes

-   Dragoon support (damage constants, resource tracking, DoT stop on leaving enemy) is a separate
    track in the handoff section 7; M0's DoT-after-cutoff test and M6's per-job cooldown list should
    wait for it. All milestones are written job-agnostically.
-   M1's document should already contain `revision`, `baselineId` and a `display` block so M7 is
    additive, not a rewrite.
-   Do not start M5/M6 result-shape changes without M0: they alter the result fingerprint basis.

## Main risks

1. Semantics drift between table, chart and CSV: mitigated by one aggregation module and M0 tests.
2. Result schema growth (M5, M6) and snapshot size versus storage limits.
3. Weighted-potency definition (Q2) is still ambiguous.
4. Provenance cannot promise engine-level replay; it promises stored results plus a labelled state.
5. Engine-adjacent changes in M6 (cooldown recording) must not alter upstream parity.
