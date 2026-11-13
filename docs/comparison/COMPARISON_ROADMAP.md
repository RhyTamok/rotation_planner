# Comparison system roadmap

Milestone plan; see the status table for what is implemented. Based on [COMPARISON_AUDIT.md](COMPARISON_AUDIT.md) and
[COMPARISON_SPEC.md](COMPARISON_SPEC.md). Effort: L / M / H. Each milestone should be one reviewable
commit series ending with `/verify-task`. Bump `AVAILABLE_RULESETS` only if a milestone changes
game data or mechanics (none planned); bump `SCHEMA_VERSION` with a migration whenever a stored
document shape changes (M1, M3b, M7).

## Status and how to use this file

| Milestone | Status                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | done, committed (2026-11-04), including the time tolerance and pull-hit rule (spec Q1)                                                                                              |
| M1        | done, committed (2026-11-04, 38a42150); schema 5. The view stays A/B over the first two configurations until M3; burst windows stay on the scenario until M5                        |
| M2        | done, committed (2026-11-05, 698c0f28): `comparison/baseline.ts`; `compareRotations` stays until M3 moves the UI                                                                    |
| M3a       | done, committed (2026-11-05, df2679e1): `comparison/competitive.ts`, `deltaPctSeries` in `baseline.ts`; pure, not yet used by the UI                                                |
| M3        | done, committed (2026-11-06, d8cb1176): N-way view, `comparison/cutoffs.ts`, `curves.ts`, `burst.ts`; `compareRotations` retired                                                    |
| M8a       | done, committed (2026-11-06, aabd4893): rotation list import, `import/rotationList.ts`                                                                                              |
| M3b       | done, committed (2026-11-07, 59777f48), reviewed by the user: schema 6, `comparison/sensitivity.ts`, competitiveness and sensitivity sections                                       |
| M4        | done, committed (2026-11-09, f450e98): `export/csv.ts`, timeline CSV (edit tab) and cutoffs CSV (compare tab); no schema change                                                     |
| M5–M8     | paused on 2026-11-13 until Phase 1 of `docs/ROADMAP.md` is done; M5 may be slotted in on request (update this row by row as each is committed). M6b (event timeline) is an addition |

For a session on one milestone, read its section plus spec sections 2–3 (definitions, data model),
and section 4 for M7. Skip the audit unless the milestone touches code it describes. Update the
status above, the audit rows the milestone changes, and the handoff at the end of the task.

## Decisions

All spec questions are decided (spec section 6), except that Q9's exact definitions are confirmed at
the start of M6. Q7 was answered on 2026-11-06: the default cutoffs are every 30 s.

## Reconciliation with `comparison-design-spec.md` (2026-11-05, reviewed and approved)

The design spec ("DS") is the UI/metric baseline; `COMPARISON_SPEC.md` ("CS") stays the locked
engine/provenance record. Nothing below changes simulation maths, event timing or boundary rules.
Status vocabulary follows DS section 11.

### Fit against the code

| DS item                                        | Status      | Evidence / action                                                                                                                                                  |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2–4 same-job configurations, baseline          | Implemented | `models/Comparison.ts` (M1), validation rejects mixed jobs                                                                                                         |
| `DPS`, `ΔDPS`, `Δ%`, rank, zero-baseline `N/A` | Implemented | `baseline.ts` (M2). Rank ties use `TIE_TOLERANCE` (1e-9 relative)                                                                                                  |
| Landing-time cutoffs, `(start,end]`, ties      | Implemented | `compare.ts`, pinned by M0 tests                                                                                                                                   |
| One settled simulation serves all cutoffs      | Implemented | Audit §2; answers DS open decision 5 (re-aggregation needs no rerun)                                                                                               |
| `ΔDPS` over time                               | Implemented | M3: `comparison/curves.ts` draws `c/t` curves and `Δ%` steps for N configurations                                                                                  |
| ε, competitive, leader coverage, regret        | Implemented | M3a maths, M3b UI: bars, regret columns, cutoff marks, annotations                                                                                                 |
| Local cutoff sensitivity `T±δ`                 | Implemented | M3b: `comparison/sensitivity.ts`, clamped with effective bounds shown                                                                                              |
| Mode (general / fight-specific)                | Dropped     | No mode field (decided). Fight-specific analysis is implied by custom timeframes (cutoffs, downtime, windows). Default cutoffs: every 30 s (Q7, M3)                |
| Analysis settings (ε, interval, δ, units)      | Implemented | M3b: `ComparisonDocument.analysis`, schema 6, outside the input fingerprint                                                                                        |
| Burst table                                    | Partial     | Exists as raid-buffed damage (party buffs included, tincture included) over scenario windows; windows still fall back to `burstWindows(resultA)` (DS: manual only) |
| Weighted potency (DS 1, 4.6)                   | Dropped     | Decided not to implement. The burst metric stays raid-buffed expected damage as simulated; DS wording to be read accordingly                                       |
| Downtime gauges, drift                         | Missing     | As M6. DS open decision 3 is already answered by CS Q6b                                                                                                            |
| Event timeline tab                             | Missing     | `RotationTable` shows one rotation only; no milestone existed. Added as M6b                                                                                        |
| One-configuration state                        | Implemented | M3: `MIN_CONFIGURATIONS = 1`; a comparison is dropped only with its last configuration; comparison metrics are hidden with one entry                               |
| Provenance, fingerprints, states, snapshots    | Planned     | Matches M7 (CS section 4, IndexedDB Q5). DS open decision 7 is answered by CS section 4                                                                            |
| CSV timeline and cutoff export                 | Implemented | M4 `export/csv.ts`. CSV import M8a                                                                                                                                 |

### Conflicts and unit traps to settle

1.  **Burst metric (resolved).** DS 1/4.6 describes weighted potency without party buffs; that is dropped.
    The burst metric is raid-buffed expected damage as simulated (CS 2.4/M5, party buffs and tincture
    included), so M5 needs no engine change.
2.  **`deltaPct` scale.** Code returns a fraction; DS and ε use percentage points. Proposal: keep fractions
    in the maths layer and convert only at the display and ε boundary; name ε `epsilonPct`.
3.  **Chart shape.** Between event times the totals are constant, so `ΔDPS` follows `c/t`, not a straight
    line, and `Δ%` is a pure step. M3 must not draw straight lines across long gaps.
4.  **Burst windows.** Remove the `burstWindows(resultA)` fallback when M5 moves windows (DS: manual only).

### Open decisions already answered by existing records

DS #3 held-seconds intervals: CS Q6b. DS #4 event stream sufficiency and #5 re-aggregation: audit §2 and
M3a below. DS #7 historical replay: CS section 4 (stored results, not engine replay). DS #2 exact ties:
`TIE_TOLERANCE`; display rounding remains open.

### Decisions from review (2026-11-05)

-   **C1:** weighted potency is not implemented. Tincture remains a self-buff, included as simulated.
-   **C2:** no per-configuration gear override. To compare gear on one rotation, duplicate the rotation and
    change its gear. Gear stays with the rotation.
-   **C3:** a one-configuration comparison is allowed (M3 changes `MIN_CONFIGURATIONS` to 1 and the removal
    rule). Comparison-only metrics (baseline deltas, rank, competitiveness, regret) are disabled with one
    entry. The per-configuration diagnostics stay: leftover gauges and cooldown held seconds (M6).
    Gauge overcap and missed uses of tracked skills are added too (CS Q9, reverses Q6 on overcap and the
    "no lost-use counts" wording). They show for one configuration as well as in comparisons. M6 gains a
    sub-task: record gauge gains discarded above the cap (read-only observation, engine-adjacent, full parity
    rerun, `RotationResult` shape change) and derive missed uses from `readyAt`. Definitions to confirm
    at M6 start (see CS Q9).
-   **C4:** ε default 0.10%, range 0.01–1.00, step 0.01. No mode field. Fight-specific analysis is implied
    by custom timeframes (custom cutoffs, downtime, windows).
-   **C5:** accepted: a cutoff beyond an entry's last landed hit is a flat total (DPS keeps decaying).

### New and adjusted milestones (existing numbers kept)

**M3a Competitiveness and regret maths (M, pure, depends on M2).** `comparison/competitive.ts`.
Between consecutive event times in the union of all series every `D_i` is constant, so leader sets,
`regretPct` and `Δ%` are piecewise constant and can change only at event times. Therefore:

-   `intervalAnalysis(series, ids, T1, T2, epsilonPct)` with `0 < T1 < T2`: exact leader and competitive
    coverage (sum interval lengths, no sampling), maximum regret (`(Dmax−D_i)/t` is largest at the
    left end of each piece), mean regret in closed form `(Dmax−D_i)·ln(t2/t1)` per piece, and
    competitive-set entry/exit timestamps with the landing events at that instant.
-   Competitiveness versus the current best, never the baseline; exact leader by rank 1 (`TIE_TOLERANCE`),
    distinct from competitive-within-ε; all-zero DPS counts as a tie and competitive, percentage regret `N/A`.
-   Reuses `totalAt`, `dpsAt`, `TIME_TOLERANCE`; no new cutoff or boundary code. Also adds a `Δ%` series.
-   **Accept:** DS section 9 practical-equivalence list. **Tests:** hand-computed fixtures with several
    rapid reversals, gaps under ε, event-boundary and simultaneous events, short intervals, 2/3/4 entries,
    ε changes alter only classification, numerical check of the integral against fine sampling, ε/baseline
    change causes no resimulation (spy). **Risk:** low; unit discipline (conflict 2).
-   **As built:** results are fractions (`regretFraction`, `maxRegretFraction`, `deltaPct`); only the
    `epsilonPct` argument is in percentage points. The last piece is a zero-length one at T2, so a hit
    landing exactly at T2 counts for maximum regret and transitions but not for coverage or mean
    regret. A gap of exactly ε is competitive (`TIE_TOLERANCE` slack on that comparison), and leaders
    are always competitive. Of the DS section 9 list, annotations, reversal display and local
    sensitivity are UI, so they remain for M3 and M3b.

**M3 (as written, plus):** graph uses `c/t` curves and steps, `Δ%` toggle, exact cutoff marker, one-entry state per C3 (`MIN_CONFIGURATIONS` 1, validation and removal rule changed, comparison metrics disabled).

-   **As built (decided with the user, 2026-11-06):**
    -   Default cutoffs are every 30 s plus the end of the fight (`comparison/cutoffs.ts`). An empty stored
        list means the default, which follows the fight's length. The first add or remove stores the list
        as shown, and "Use every 30 s" empties it again. No schema change. Removing the last stored
        cutoff also returns to the default, so "end of fight only" is not available (accepted by the
        user). No other preset values exist yet.
    -   The running DPS chart, burst table and gauges went N-way. Gauges and totals moved to a
        collapsible table (open with one entry). The burst table has per-configuration totals and
        differences (`comparison/burst.ts`); moving the windows remains M5.
    -   The lead changes list is removed until M3b's transition annotations.
    -   `compareRotations`, `leadChanges`, `differenceSeries`, `sampleTimes` and `dpsSamples` are retired.
    -   A failed configuration no longer hides the others. If the baseline fails, differences hide
        while DPS, totals and ranks stay.
    -   The graph unit is session-only until M3b's stored analysis settings.
    -   A configuration's letter and colour come from its position (lines solid since 2026-11-07): stable across baseline
        changes, but removing A renames the rest.
    -   Not built: stat summaries on cards, row-to-graph selection, line and overlay toggles.

**M3b Interpretive UI (M, depends on M3, M3a).** ε control, competitiveness bars and regret columns,
local sensitivity `[T−δ,T+δ]` clamped to the available positive-time domain with effective bounds shown,
transition annotations, "all within threshold" message, analysis settings stored on the comparison
(schema 6 + migration; ε default 0.10 within 0.01–1.00 step 0.01, interval, δ). Component tests for classification text and clamping.

-   **As built (2026-11-07):**
    -   `ComparisonDocument.analysis` holds ε, the graph unit (no longer session-only), the interval and
        sensitivity's T and δ. `comparison/sensitivity.ts` is new; `competitive.ts` gained `competitiveAt`
        and `leaderChanges`.
    -   Defaults chosen here: the interval follows the chart range (start of the chart to the end of the
        fight), so the opener does not dominate maximum regret; T is the end of the fight; δ is 10 s.
    -   Times are limited to 1 s through the longest configuration's end, like the charts, and the
        effective bounds are shown. T ± δ wholly outside the fight shows a message; nothing is extrapolated.
    -   DS 4.5's "best/worst comparative DPS gap" is read as the lowest and highest `ΔDPS` against the
        baseline, because a gap against the best would repeat maximum regret. Hidden without a baseline.
    -   Competitiveness needs no baseline, so it stays when the baseline fails, and hides with one entry.
    -   Validation checks each setting alone. An interval that is empty for now is stored, and the view
        says so, because an invalid document would stop the whole workspace from saving.
    -   The chart draws ▲/▼ for competitive-set changes in the evaluated interval, but none above 24
        changes. Every change, with its landings, and every exact leader change are in a collapsed list.
    -   Charts, after the user's review (2026-11-07): full panel width and `clamp(260px, 42vh, 640px)`
        tall, drawn at their pixel size so text stays 12 px. Each chart zooms with the wheel around the
        pointer, pans by dragging, resets on a double click or "Show all", and fits its y axis to the
        range on show (`ui/compare/viewRange.ts`). Zoom is per chart and not stored.
    -   Not built: an ε band on the graph (DS 3.1 only allows it relative to the baseline), sorting.

**M5 (adjusted):** manual windows only (drop the `burstWindows(resultA)` fallback). No weighted potency.

**M6b Event timeline tab (M, depends on M3, M4).** Per-action and per-landing records for the selected cutoff,
linked to graph selection, reusing M4's rows. Landing time shown beside press time.

**M7 (adjusted):** snapshots include the analysis settings, kept out of the input fingerprint.

Suggested order: M3a, M3, M3b (MVP boundary stays M0–M3; M3a/M3b are the first post-MVP step),
then M4, M5, M6, M6b, M7, M8.

## Minimum viable comparison = M0 + M1 + M2 + M3

Why: the engine, caching and cutoff maths already exist, so the smallest valuable step is to
generalize them from "A vs B" to "N configurations vs a baseline" with correct, tested definitions.
It delivers views A and B (the primary question: who wins at which kill time) and needs no result
schema change, so it cannot disturb numerical correctness.

## M0 Pin the semantics (L)

-   **Objective:** make the cutoff/boundary rules executable before building on them.
-   **Reuse:** `totalAt`, `dpsAt`, `totalBetween`, `simulateRotation`, existing real-rotation parity test.
-   **Changes:** add tests only (plus changing `totalBetween` to `(start, end]` per Q1, updating the assertion at l. 69 with a
    visible note, never silently).
    Tests: a hit landing exactly at a cutoff counts; a hit 1 ms later does not; downtime hit counts 0;
    cutoff in downtime uses full elapsed time; window boundary `(start, end]`; `lastAction` versus `settled`
    behavior for pending hits; DoT after cutoff once Dragoon exists (marked pending).
-   **Files:** `src/__test__/rotationLabCompare.test.ts`, `rotationLabEncounter.test.ts`.
-   **Depends on:** Q1 (decided). **Accept:** semantics table in the audit matches passing tests. **Risk:** Q1
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
-   **Changes:** configuration picker (add/remove, 1–4 per C3), baseline radio, default cutoffs (Q7) with
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
-   **As built (decided with the user, 2026-11-09):**
    -   Two files, two places: "Download timeline CSV" in the header bar after Delete, edit tab only (one file per rotation, the one
        on show) and "Download cutoffs CSV" with the cutoff controls in the compare tab (one file, one
        row per cutoff and configuration). The UI is in `ui/CsvDownload.tsx`.
    -   Format choice ("Comma" or "Semicolon", details in the option tooltips) beside each button, shared and kept in `localStorage` (per viewer, not in the
        workspace): comma with decimal point, or semicolon with decimal comma for German-language
        Excel. Fixed decimals (times 3, amounts 2, Δ% 4 in percentage points), UTF-8 byte order mark,
        CRLF. Formula prefix only on text cells (also leading tab/CR), so negative numbers stay numbers.
    -   Timeline: press time only, no landing times (the user's tools work out landings). `skill_name`
        is the executed skill's displayed name, `pressed` the button; the M8a import reads the file
        back as the same executed skills (tested, comma and semicolon). Gauges are one column each;
        timers and modifiers are not exported. Steps without an action (simulation errors) have no row.
    -   Summary: the cells the table hides are empty (differences without a baseline, rank and
        within-ε with one configuration); within-ε comes from `competitiveAt`; failed configurations
        are left out; potency headers (`pps`) without a damage model.
    -   No landings CSV, so M6b must still link damage events to actions itself.

## M5 Burst windows in the comparison (L)

-   **Objective:** view C: raid-buffed damage per shared burst window for N configurations, versus the
    baseline (absolute, % and rank, like the cutoff table).
-   **Reuse:** `ScenarioDocument.burstWindows`/`burstWindows()`, `totalBetween`, M2's baseline maths.
-   **Changes:** move window definitions into the comparison document (M1), `comparison/burst.ts`
    over the M2 helpers, window boundary `(start, end]` (Q1, already applied in M0).
-   **Depends on:** M0, M2. **Accept:** adjacent windows never double-count a hit; non-2-minute
    windows work; same buff schedule with different damage distribution gives different totals.
    **Tests:** fixtures with a hand-built party-buff schedule and hits placed exactly on boundaries.
    **Risk:** low; no result-shape change.

## M6 Resources, downtime and drift (H)

-   **Objective:** views D and E.
-   **Changes:** (a) gauges at downtime start and end through the existing `gaugesAt` (Q4, no new extraction);
    (b) record cooldown readiness per executed action (`readyAt`, from `CoolDown` state in the
    simulator, not new rules) for a per-job key cooldown list (Q6: Serpent's Ire, Vicewinder/Vicepit as one shared pool; Lance Charge, Geirskogul, Battle Litany, High Jump, Dragonfire Dive); (c) `comparison/drift.ts`: held
    seconds = Σ(press − ready) per use, minus overlap with downtime windows, attributed to intervals
    between downtimes; (d) downtime panel: gauges/cooldowns at entry and exit, `deltaDPS` immediately
    before and after, with instants labelled.
-   **Depends on:** M2. **Accept:** held time excludes untargetable seconds and has no grace
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
-   **Changes:** `ENGINE_VERSION` string constant (Q3, decided); `provenance/fingerprint.ts` (SHA-256 via `crypto.subtle`, async;
    canonical result serialization with fixed number formatting); `models/ComparisonSnapshot.ts`
    (frozen configurations with full `ResolvedGear`, stored results); `storage/SnapshotStore.ts`
    (IndexedDB, decided in Q5, behind a small interface so tests use an in-memory store);
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

## M8a Rotation list import (L, moved ahead for easier testing, 2026-11-06)

Done (aabd4893): `import/rotationList.ts`, through the existing Import button (`.csv`, `.txt`).
The format was decided with the user: one displayed skill name per line. A CSV with a `skill_name`,
`skill` or `action` column also works, and `#` lines are skipped. Only the order is read. Time and
target columns are ignored and named in a message, because the simulator works out timing. Any
unknown name rejects the whole file, with line numbers. It creates a new, undoable rotation on the
current rotation's gear. Not read: gear stats (`#stats`), per-skill targets, waits.

## M8 Preset management and polish (M)

Preset management, snapshot list UI, optional revision diffs. Do after the others.

## Ordering notes

-   Dragoon support (damage constants, resource tracking, DoT stop on leaving enemy) is a separate
    track in the handoff section 7; M0's DoT-after-cutoff test and M6's per-job cooldown list should
    wait for it. All milestones are written job-agnostically.
-   M1's document should already contain `revision`, `baselineId` and a `display` block so M7 is
    additive, not a rewrite.
-   Do not start the M6 result-shape change without M0: it alters the result fingerprint basis.

## Main risks

1. Semantics drift between table, chart and CSV: mitigated by one aggregation module and M0 tests.
2. Result schema growth (M5, M6) and snapshot size versus storage limits.
3. Drift metric details (shared Vicewinder/Vicepit pool, capped-stretch attribution) are untested against the engine's cooldown groups.
4. Provenance cannot promise engine-level replay; it promises stored results plus a labelled state.
5. Engine-adjacent changes in M6 (cooldown recording) must not alter upstream parity.
