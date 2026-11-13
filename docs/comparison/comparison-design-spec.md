# Rotation Lab — Comparison Workspace Design Specification

**Status:** Implementation baseline / proposed UI specification  
**Audience:** Claude Code, maintainers, expert VPR/DRG theorycrafters  
**Scope:** Comparison UI, metrics, interactions, data contracts, validation  
**Source:** Agreed Phase 1–3 decisions (November 2026)

> **To Claude Code:** Inspect the repository before implementation. Reuse the authoritative engine timing, boundary rules, and data structures. This document describes intended behavior, **not** an assertion that features exist. Mark mismatches and unverified assumptions; do not invent mechanics or silently change damage formulas.

## 1. Locked product requirements

-   Rotation Lab is browser-only, built on XIV in the Shell. Simulation uses deterministic expected damage, validated externally. **No RNG simulation.**
-   Compare **2–4 configurations of the same job**, initially VPR or DRG. One entry is the baseline. A _configuration_ pairs a rotation with its own **externally optimized gearset**; speed-dependent rotations and gearsets can differ. Do not attribute a combined performance difference exclusively to rotation or stats.
-   **Cutoffs:** adjustable ruleset-specific standard cutoff presets. There is no mode switch: fight-specific analysis (cutoff sweep, fixed-timestamp downtime, custom windows) is entered automatically once custom timeframes are added. No HP-gated phases.
-   Damage counts **when it lands**; ticks after a cutoff count as zero. The existing engine's event ordering, timestamp precision, and boundary semantics are authoritative. **DPS = landed cumulative damage / elapsed encounter time**, including downtime.
-   Main chart shows **DPS difference over time** versus baseline, not cumulative total-damage difference.
-   Burst windows are **manually placed and shared** across entries. The burst metric is expected damage as simulated, **including party buffs and tincture** (no weighted-potency metric; decided 2026-11-05). No assumed 2-minute cycle.
-   Leftover gauges/resources at cutoff are indicators only; **never** convert them to damage or DPS, or color them as inherently good/bad.
-   Drift = **seconds key cooldowns are held** in encounter intervals/phases, with untargetable time excused and no grace period. Gauge **overcap** and **missed uses** of tracked skills are shown as counts observed in the simulated timeline (CS Q9, exact definitions settled in M6). **Do not** calculate a theoretical maximum achievable number of uses or convert any of it into damage.
-   Existing/planned data exchange: CSV import for rotations, CSV exports for per-action timeline and per-cutoff summaries, and JSON comparison snapshots for provenance.
-   Preserve ruleset/job neutrality for future expansion changes without inventing Evercold mechanics.

## 2. Desktop information architecture

Use one vertically scrollable analytical workspace with progressive disclosure, optimized for desktop widths around 1280–1600 CSS px, and adapt to smaller screens.

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Rotation Lab / Comparison Name                                  [Status] [Export]│
│ Job · Ruleset · Snapshot revision  [Provenance ▾]                                │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Cutoffs/preset                    Baseline [A ▾]                                 │
│ Relevance threshold ε [%]   Graph [ΔDPS | Δ%]   [Run/Refresh]                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ [A · BASELINE]     [B]                   [C]                  [D, if present]    │
│ Rotation+gear     Rotation+gear         Rotation+gear        Rotation+gear      │
│ GCD/stat summary  GCD/stat summary      GCD/stat summary     GCD/stat summary   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ DPS DIFFERENCE OVER TIME                                                         │
│ X: elapsed time; Y: DPS vs baseline. Lines; downtime/burst bands; cutoff marks. │
│ Hover: precise values. Select cutoff. Relevant competitiveness transitions.    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ CUTOFF TABLE                                                                     │
│ Cutoff | A: DPS, Δ, Δ% | B: DPS, Δ, Δ% | C... | D... | leftovers (expand)        │
│ Exact leaders and within-ε indicators; sync selected row with graph.           │
├─────────────────────────────────┬────────────────────────────────────────────────┤
│ COMPETITIVENESS & REGRET        │ LOCAL CUTOFF SENSITIVITY                       │
│ Leader/near-best coverage       │ Selected T ± δ, worst/best gap, stability       │
│ Mean/max regret                │                                                │
├─────────────────────────────────┴────────────────────────────────────────────────┤
│ DETAIL: [Burst] [Downtime & Drift] [Resources] [Event Timeline]                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Ruleset / engine / fingerprint                    [CSV] [JSON snapshot]         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Visual priority:** timeline → cutoff table → competitiveness/regret → detailed diagnostics. Maintain consistent entry labels/colors/line patterns across every view. Baseline appears neutrally, with a dashed zero reference line on the difference graph. Never rely on color alone.

## 3. Mathematical definitions

Use authoritative event data. Let `D_i(t)` be cumulative expected damage that **landed** by positive encounter time `t`; `b` is the selected baseline, and `i` indexes configurations.

| Metric             | Definition                        | Interpretation                                                   |
| ------------------ | --------------------------------- | ---------------------------------------------------------------- |
| `DPS_i(t)`         | `D_i(t) / t`                      | Elapsed time includes downtime; `t > 0`.                         |
| `deltaDPS_i(t)`    | `DPS_i(t) − DPS_b(t)`             | Primary graph; baseline exactly 0.                               |
| `deltaPct_i(t)`    | `100 × (DPS_i(t) / DPS_b(t) − 1)` | Percent **versus baseline**; undefined when baseline DPS = 0.    |
| `bestDPS(t)`       | `max_j DPS_j(t)`                  | Best of all compared configurations.                             |
| `regretDPS_i(t)`   | `bestDPS(t) − DPS_i(t)`           | DPS deficit versus current best; ≥ 0.                            |
| `regretPct_i(t)`   | `100 × regretDPS_i(t)/bestDPS(t)` | Percent deficit **versus best**, not baseline.                   |
| `competitive_i(t)` | `regretPct_i(t) ≤ ε`              | `ε` is in percentage points, e.g. 0.10 means 0.10%.              |
| `leader_i(t)`      | `DPS_i(t) = bestDPS(t)`           | Exact leader or tie using engine numerical precision, **not** ε. |

If all configurations have zero DPS at a time, treat them as tied and competitive, and use a consistent, clearly documented N/A or 0 convention for undefined percentage regret. At `t=0`, DPS is undefined; choose a positive-time analysis start. When baseline DPS is 0, show absolute quantities and `N/A` for baseline-relative ratios.

### 3.1 Practical relevance threshold

-   `ε` changes **interpretation and UI emphasis only**, never simulation results. Default **0.10%** (not a validated significance level), user-adjustable from 0.01% to 1.00% in steps of 0.01% (decided 2026-11-05).
-   **Competitive** = within ε percent of the **best** configuration at that timestamp. Several entries can be competitive simultaneously. Distinguish exact leader, competitive-not-leader, and outside threshold.
-   ε is a **decision threshold**, not statistical significance or a confidence interval; deterministic small differences can be real.
-   A ±ε band around the graph's baseline-relative zero line **does not establish near-best competitiveness**. If offered, label it explicitly as _relative to baseline_ and only in percentage mode (a fixed absolute-DPS band would be dimensionally wrong).

### 3.2 Interval-weighted metrics

For an evaluation interval `[T1,T2]`, where `0 < T1 < T2`:

-   **Leader coverage:** `duration(leader_i) / (T2−T1)`.
-   **Competitive coverage:** `duration(competitive_i) / (T2−T1)`.
-   **Additional competitive coverage:** time competitive but not exact leader (for the lighter section of each bar).
-   **Maximum regret:** `max_t regretDPS_i(t)` in DPS; optionally display separate percentage regret.
-   **Mean regret:** `∫[T1,T2] regretDPS_i(t) dt / (T2−T1)` in DPS.

Coverage is a proportion of the selected **time interval**, not an empirical probability of real kill times. Multi-entry competitive coverage is **not mutually exclusive**, and ties can cause several entries to count as leaders at once.

**Correctness:** Compute coverage from actual landed-damage event boundaries, not by counting samples or standard cutoffs. In between events, cumulative damage remains constant but DPS changes as `1/t`. Account for this in mean absolute DPS regret (exact piecewise integral if feasible or a validated approximation with specified accuracy). Handle simultaneous events and interval endpoints using current engine semantics. This avoids missing short-lived flips.

## 4. Component specifications

### 4.1 Comparison controls and configuration cards

-   Display 2–4 cards in fixed order; each shows stable label, paired rotation + gearset, GCD/speed and essential stat summary, and baseline designation.
-   Baseline can be changed without resimulating already-evaluated configurations. Clearly mark stale simulation outputs if inputs change.
-   Controls include cutoff presets/range, ε, graph absolute/percentage view, shown series, selected cutoff, and compact expandable provenance.
-   A configuration is a **paired rotation and gearset**; do not enforce shared stats or a shared action sequence.

### 4.2 DPS difference-over-time graph — primary

| Aspect       | Specification                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose      | Show when DPS differences emerge, shrink, reverse, or become meaningfully competitive.                                                         |
| X-axis       | Elapsed encounter time; clearly labeled time units.                                                                                            |
| Y-axis       | Default `deltaDPS` in DPS units; user toggle to `deltaPct` vs baseline.                                                                        |
| Series       | 1–3 entry lines for 2–4 configurations; stable distinct colors **and** line patterns; neutral dashed zero baseline.                            |
| Overlays     | Shared burst windows, downtime bands, exact cutoff markers; visually distinguish overlays and handle overlaps.                                 |
| Hover        | Timestamp; absolute DPS, delta DPS, delta %, and best-relative ε state for every entry.                                                        |
| Interactions | Scrub/hover, click to select cutoff, toggle lines and overlays, inspect exact damage events causing changes.                                   |
| Reversals    | Exact lead changes remain inspectable; default annotations emphasize **entrances/exits from the competitive set**, not every tiny leader swap. |

The primary line represents **cumulative DPS difference at time `t`**, not instantaneous DPS, a per-action damage series, or absolute total-damage difference. After the last landed damage event, the absolute DPS gap can decay over time even without new events. Use graph interpolation that respects the event-based calculation and do not visually manufacture smoothly changing damage.

### 4.3 Cutoff comparison table — primary

-   Rows: exact preset/custom cutoffs. Columns per entry: **absolute DPS**, **ΔDPS**, **Δ% vs baseline**. Leftover resources can be in expandable cells or a dedicated matrix to avoid excessive width.
-   Highlight the exact leading configuration and mark all configurations within ε of best; separate these concepts. If all qualify, show “All configurations within the selected threshold.”
-   Select a row to synchronize the vertical graph marker and relevant detail tabs. Support adequate decimal precision or optional expanded precision for close differences; never round before ranking.
-   Support sorting and horizontal scrolling with sticky cutoff column/header for four entries. Show undefined values as `N/A` with explanation rather than making up percentages.

### 4.4 Competitiveness and regret — secondary summary

-   Per configuration, use one horizontal bar: **exact leader coverage**, then **additional competitive-but-not-leader coverage**, then unfilled remainder outside ε.
-   Adjacent columns: leader coverage %, total competitive coverage %, **maximum regret in DPS**, **mean regret in DPS**; optional percentage regret must be separate and labeled.
-   Coverage bars describe each configuration individually; do not force total coverage across different configurations to sum to 100%.
-   Show the evaluated time interval and ε next to results. Recompute summaries when these controls change without rerunning the underlying simulation.
-   **Do not** auto-declare one recommended winner based solely on leader frequency; the size and timing of regret matter.

### 4.5 Local cutoff sensitivity — secondary summary

-   User chooses cutoff `T` and half-width `δ` seconds, evaluating `[T−δ,T+δ]`, clamped to an available, positive-time timeline domain. Display effective bounds if clamped.
-   For each entry, show whether it remains competitive throughout the interval, best/worst comparative DPS gap, and maximum regret.
-   Highlight that region on the main graph. This tests **kill-time variation**, **not** shifted downtime or shifted execution schedules.
-   Reuse evaluated events when the horizon covers the region; if not, show that additional simulation/evaluation is needed rather than silently extrapolating.

### 4.6 Burst table — detailed tab

-   Rows: shared, manually placed burst intervals; no fixed cycle length.
-   Columns: expected damage by configuration (party buffs and tincture included, as simulated) and differences to baseline.
-   Reuse verified engine formulas and attribution rules. Determine whether the current simulator attributes windows by action timing, effect application, or damage landing; document actual behavior, and maintain clarity with the cutoff rule.

### 4.7 Downtime and drift — detailed tab

-   For each fixed downtime interval, show selected resource and cooldown states at **entry** and **exit**, plus relative DPS gap at its two boundaries (using documented engine boundary semantics).
-   For selected job-specific key cooldowns, show **time held per encounter interval/phase**, excluding untargetable time. Every other eligible second counts with no grace period.
-   Also show, per configuration, **missed uses** of the tracked skills as observed counts (a recharge or cooldown left unused while the skill sat at maximum stacks, or a use that never happened before the fight ended; definitions per CS Q9, settled in M6). Do **not** calculate a theoretical maximum achievable number of uses or a feasibility judgment. This is an expert diagnostic, not an optimizer.
-   Define what “just before/after downtime” means using actual event ordering and boundary timestamps; avoid arbitrary hidden time offsets.

### 4.8 Leftover resource matrix — detailed tab

-   Rows: cutoffs and downtime entry/exit boundaries. Columns: configurations and relevant gauges/resources, with each gauge's **overcap** (gain discarded above the cap, observed from the simulation; CS Q9) shown beside its leftover value.
-   Show raw state values and optional neutral mini-bars scaled to the resource's known range. Different resource types must not be averaged or conflated.
-   No green/red implications, implicit ranking of configurations by overcap, or DPS-equivalent conversions. Use job/ruleset definitions for resource types and limits.

### 4.9 Event timeline — detailed tab

-   Show available per-action and per-damage-event records, linked to graph selection. Include damage-landing timestamps where they differ from action execution; do not invent undocumented action semantics.
-   Allow investigating cutoff discontinuities and ranking transitions. Reuse existing CSV timeline/export infrastructure where possible.

## 5. Interaction and edge states

| State                         | Expected behavior                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One configuration             | Allowed (decided). Single-configuration workspace with Add Configuration action; comparison metrics (baseline deltas, rank, competitiveness, regret) are disabled, while leftover gauges, overcap, held seconds and missed uses still show. |
| Two entries                   | One comparison line relative to baseline.                                                                                                                                                                                                   |
| Four entries                  | Four compact cards, three difference series; cutoff table remains navigable with sticky labels/horizontal scrolling.                                                                                                                        |
| No downtime                   | Hide downtime-specific graph bands and analysis; preserve burst, cutoff, and resource views.                                                                                                                                                |
| Many tiny ranking flips       | Default graph does not fill with reversal markers; all exact changes can still be inspected.                                                                                                                                                |
| Meaningful transition         | Annotate a configuration entering/leaving best-relative ε competitiveness, with precise timestamp and associated landing events.                                                                                                            |
| All within ε                  | Neutral message: “All configurations within selected threshold”; exact values remain visible.                                                                                                                                               |
| Exact tie                     | Represent joint leaders, not an arbitrary chosen winner.                                                                                                                                                                                    |
| Baseline DPS zero             | Show absolute DPS, mark percentage vs baseline undefined.                                                                                                                                                                                   |
| Start of encounter            | No `DPS(t)` at `t=0`; require a positive evaluation start for summaries.                                                                                                                                                                    |
| Insufficient timeline horizon | Transparently restrict interval or request evaluation; no extrapolated results.                                                                                                                                                             |
| Stale inputs                  | Mark results stale; do not present old outputs as newly calculated.                                                                                                                                                                         |
| Historical version            | Preserve original output and ruleset; any new-engine recalculation creates a separate revision.                                                                                                                                             |

## 6. Provenance and exports

Follow the agreed provenance concept:

-   Compact title-adjacent metadata: ruleset, engine version, revision, comparison status; expandable full provenance.
-   Save **immutable comparison snapshots** with shared settings, complete rotation definitions, actual numerical gearset inputs, ruleset/engine/formula identifiers, timestamp, and input/result fingerprints.
-   Proposed fingerprint mechanism: canonical serialization + SHA-256; distinguish simulation-affecting inputs, derived-analysis settings (baseline, ε, evaluation interval), and purely visual settings.
-   States: **Current, Stale, Historical, Unverified**. Historical does not automatically imply invalid.
-   Changing baseline or ε does not change individual simulation damage or require simulation rerun.
-   JSON snapshot import/export is distinct from existing/planned CSV rotation import and CSV timeline/cutoff export.
-   Prefer existing browser persistence; IndexedDB is an option, not a required dependency. Commit IDs alone do not guarantee historical executability.

## 7. Conceptual data contracts

Map these concepts to current code instead of inventing duplicate types. Names below are illustrative, **not** mandated TypeScript interfaces.

| Concept                | Essential contents                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ComparisonDefinition` | ID, job, ruleset, configuration IDs, baseline ID, cutoff timestamps/range, shared downtime/burst windows, raid-buff schedule. |
| `Configuration`        | Stable ID, label, rotation snapshot, numerical gearset stats, GCD/speed metadata.                                             |
| `SimulatedTimeline`    | Configuration ID, valid horizon, landed-damage events, cumulative damage, gauge/cooldown state, event provenance.             |
| `CutoffEvaluation`     | Timestamp, per-configuration DPS, ΔDPS, Δ%, exact leaders, resources.                                                         |
| `AnalysisSettings`     | ε, selected interval/cutoff, local sensitivity δ, graph units, visibility controls.                                           |
| `IntervalAnalysis`     | Leader/competitive time coverage, max/mean regret, competitiveness transition timestamps.                                     |
| `ComparisonSnapshot`   | Versioned complete inputs, execution metadata, fingerprint(s), saved results, validity state.                                 |

Determine ownership/caching boundaries between: (1) inputs, (2) engine output, (3) aggregation over cutoffs/time intervals, (4) visualization state. Changing inputs may invalidate simulation; changing baseline or ε should affect only derived layers when data permits.

## 8. Suggested implementation order

The order is **dependency guidance**, not a substitute for repository audit:

1. **Audit current code:** engine event/cutoff behavior, timestamp semantics, timeline accessibility, buff path, existing comparisons, imports/exports, persistence and tests. Record conflicts instead of modifying formulas.
2. **Data contract & validated comparison MVP:** support distinct rotation+gearset configuration inputs, common cutoffs, absolute/relative DPS, baseline switching, proper zero cases; compare results against existing independent checks.
3. **Primary workspace:** cards, difference-over-time graph, cutoff table, synchronized selection, baseline controls, empty/loading/stale/error states.
4. **Interpretive metrics:** ε, competitive classification, exact-leader and near-best coverage, regret, meaningful transitions, local cutoff sensitivity. Optimize around actual event boundaries.
5. **Detailed diagnostics:** shared burst expected damage; resource states and overcap; downtime entry/exit, per-phase cooldown-held seconds and missed uses; event inspection.
6. **Provenance/persistence and data exchange:** immutable snapshots, version/fingerprints, validity states, JSON export/import, existing CSV flows. **Establish necessary IDs/schema foundations earlier** to avoid rewrites.
7. **Usability/performance:** four-entry density, precision/rounding controls, accessibility, many-event timelines, keyboard and responsive interactions.

**MVP release boundary:** two same-job configurations with independent gearsets/rotations, one baseline, shared cutoff(s), correct absolute and relative DPS, time-difference graph, cutoff table, and numerical verification. Advanced metrics can follow once the core is correct.

## 9. Acceptance criteria and tests

### Core calculations

-   [ ] 2, 3, and 4 entries work; cross-job comparisons are rejected.
-   [ ] Configurations keep independent rotations and numerical gearsets/GCD speed.
-   [ ] All views reuse engine landing-time/cutoff semantics; ticks after the cutoff are absent.
-   [ ] DPS denominator includes downtime; per-cutoff UI agrees with exported summaries to the documented display precision.
-   [ ] Baseline switching changes deltas and ratios only, not underlying simulation DPS.
-   [ ] Baseline zero DPS, `t=0`, simultaneous damage events, and exact ties are safe and explicit.

### Practical-equivalence analysis

-   [ ] ε changes classifications, coverage and annotations without changing raw damage or rerunning engine calculations.
-   [ ] Competitiveness is measured versus **current best**, not versus baseline.
-   [ ] Exact leader and competitive-but-not-leader are distinguished; multiple entries may be simultaneously competitive.
-   [ ] Time coverage is weighted by **elapsed duration** and not the count/density of sampled cutoffs.
-   [ ] Synthetic deterministic tests verify multiple rapid reversals, very small gaps, event boundaries, and short intervals.
-   [ ] Mean regret respects within-event `1/t` DPS behavior; maximum regret and units are validated.
-   [ ] Exact reversals are discoverable without flooding the default graph.
-   [ ] Local sensitivity measures cutoff variation only, using actual available time interval.

### Diagnostic views

-   [ ] Shared burst windows work at arbitrary timestamps; burst windows report party-buffed expected damage with adjacent windows never double counting.
-   [ ] No-downtime comparisons omit downtime UI without breaking other metrics.
-   [ ] Cooldown held seconds exclude untargetability, have no grace period, and are reported separately from missed-use counts (CS Q9). Overcap and missed uses are observed from the timeline, never converted to damage.
-   [ ] Cutoff/downtime leftover gauges show actual state without subjective good/bad encoding or DPS conversion.
-   [ ] Selected cutoff remains synchronized across chart, table, and detail tabs.

### Persistence and maintenance

-   [ ] Immutable snapshots retain complete numerical gearsets, rotations, and relevant rules/version metadata independently of external editable references.
-   [ ] Canonical fingerprints are stable for identical numerical inputs; changing simulation inputs invalidates relevant cached outputs.
-   [ ] Baseline/threshold/display changes do not incorrectly invalidate simulation fingerprints.
-   [ ] Historical results are not silently rewritten; stale/unverified states are distinguishable.
-   [ ] Import validation is safe for malformed/untrusted JSON and CSV, with schema version checks.
-   [ ] Keyboard interaction, accessible non-color encodings, and precision controls work in dense four-entry views.

## 10. Open decisions (do not silently invent answers)

1. ~~ε default, range, precision~~ Decided: 0.10%, 0.01–1.00, step 0.01.
2. Display rounding policy for very small differences, alongside engine numerical tolerance for exact ties.
3. Exact encounter-interval/phase definition for reporting held cooldown seconds, especially without downtime.
4. Whether the existing event stream provides enough detail for precise reversal attribution and analytical integration.
5. Whether cutoff changes within an already-evaluated horizon can be re-aggregated without simulation.
6. Presentation of resources in expanded cutoff cells versus a separate matrix (or both).
7. How long-term historical engine versions can be retrieved or executed for exact replay.

## 11. Claude Code handoff checklist

1. Map this specification to real repository components and source files. Report **Implemented / Partial / Missing / Conflicting / Unverified** with concrete evidence.
2. Document the existing timestamp, damage attribution, buff normalization, and cutoff rules; preserve them.
3. Establish or reuse the conceptual data contracts and decide which values require new simulations versus cheap re-aggregation.
4. Produce small, independently testable milestones, including a minimal comparison MVP and explicit dependencies.
5. Update documentation to distinguish current implementation from planned behavior; list unresolved product decisions.
6. **Do not assume this UI mockup is already implemented. Do not change production code solely because this document exists without explicit implementation authorization.**
