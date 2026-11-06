# Project Handoff: FFXIV Viper Rotation Lab

Current state of the project for a new Claude Code session. Read this after `CLAUDE.md`.
Last updated 2026-11-06 (comparison milestone M3: N-way comparison view).

The full history of sessions 1–3 is in `docs/archive/PROJECT_HANDOFF_sessions-1-3.md`: every
finding, decision and bug in detail, with the original roadmap. Search it rather than reading it
whole; it is about 2,500 lines.

Treat this file as context, not proof. Check the repository and run the tests before relying on
any status written here.

---

## 1. What the project is

An independently maintained fork of [XIV in the Shell](https://github.com/xivintheshell/xivintheshell)
(MIT), focused on Viper (VPR) and later Dragoon (DRG). It adds the **Rotation Lab**, a separate
page for planning and comparing rotations:

-   A fast, vertical rotation editor in the spirit of Rubixbob's planner.
-   **Deterministic expected damage**, not Monte Carlo, using XIV in the Shell's engine for the
    mechanics and xivgear's formulas for damage.
-   Comparison of independent rotations under the same fight conditions, by **DPS** (the user's
    main metric), at any fight length and inside burst windows.
-   Rulesets per combat mode: Reborn now. **Evolved** arrives with the Evercold release (expected
    February 2027, dates unverified) and will become the main focus. Do not invent Evolved mechanics
    or potencies.
-   Local-first: everything runs in the browser and is saved in `localStorage`. The only network
    use is the optional xivgear gear import.

A non-technical overview for the user's friends lives in a shared doc, "Viper Rotation Lab –
Project Overview" (https://claude.ai/artifact/SQPpsCypBnSjQHRKmvWxku). Update it when the feature
set changes.

## 2. Working with this user

-   Commits are made by the user in GitHub Desktop. At the end of each task, give a suggested
    commit message and the file list. Never commit or push yourself; never force-push.
-   The user is cost-conscious. Read narrowly (grep, line ranges), batch shell checks, iterate on
    `src/__test__/rotationLab*` tests and run the full suite once at the end.
-   The user knows Viper mechanics in depth and corrects them readily. Ask when mechanics are
    ambiguous instead of guessing, and record their answers here (section 6).
-   The user runs Firefox. Behaviour that differs between browsers (clipboard, layout) needs a
    Firefox-safe path.
-   Keep this file and `CLAUDE.md` up to date at the end of every task: add new facts, remove stale
    ones.

## 3. Current state (verified 2026-11-04)

-   Branch `feature/rotation-lab`. Full suite: 41 files, 320 passed + 9 expected-fail (upstream
    `it.fails`) + 1 todo (DoT after a cutoff). `tsc --noEmit` clean;
    ESLint clean on `src/RotationLab`; dev-load page check `errors: none` (M1, no browser review
    yet).
-   The original app at `/` is unchanged in behaviour; the user confirmed it after the engine changes.
-   Rotation Lab: http://localhost:3000/rotation-lab.html (`npm.cmd run start`).

### Features

-   **Editor** (`ui/RotationTable.tsx`, `ui/SkillPalette.tsx`):
    -   Rows show time, party-buff lanes, action, an oGCD delay field, potency, expected damage,
        gauges (Rattling Coil, Serpent Offerings, Anguine Tribute) and notes.
    -   Notes cover invalid actions, pull hold, clipped GCDs and GCD delays, ghosting (with the
        amount), combo breaks, and damage that lands after the cutoff.
    -   A sticky bar shows the selected row's buff and combo timers as icons, soonest first, plus a
        Debug toggle for the Δ GCD and Δ action columns.
    -   The palette mirrors the hotbar at the insertion point: combo follow-ups, cooldown overlays,
        charges, unusable buttons dimmed.
    -   Editing: Shift+click or Shift+↑/↓ range selection, Ctrl+A, Delete, ×, Ctrl+D, Alt+↑/↓,
        drag-and-drop, Ctrl+C/X/V through the system clipboard, and workspace-wide Ctrl+Z/Y.
-   **Recommendations** (`ui/RecommendationPanel.tsx`, `recommend/`), Viper only:
    -   A floating panel, dragged by its title bar, ranks the next actions at the insertion point
        (GCDs and oGCDs in one list) with the ruleset row and reason. "All" shows the whole list
        (phase 1), "Best" only the top entry (phase 2). Position and mode are kept in localStorage.
    -   Clicking an entry inserts it. Actions that need a target in downtime are listed under
        "Filtered".
    -   The panel shows the buff and combo timers at the insertion point (`TimerChips`, shared with
        the table's timer bar). The user's main focus is this panel.
    -   The AoE family is picked from the rotation's target ranges at the next press (below).
-   **Targets** (`ui/TargetsPanel.tsx`, `rules/targets.ts`, session 5): per rotation, at the bottom
    of the sidebar. A table of ranges (start, end, enemies in seconds from the pull), with per-row
    errors for overlaps and empty ranges and "copy targets from" another rotation. The table's
    Targets column shows "×N" when an action hit more than one enemy. Rules: section 6.
-   **Gear** (`ui/GearPanel.tsx`): each rotation picks a gear set and can override single values;
    the base GCD is shown. Gear sets can be imported from xivgear set, sheet or BiS links.
-   **Scenario** (`ui/ScenarioPanel.tsx`), shared by every rotation compared under it: level, party
    bonus, countdown, FPS tax (0 = off, the default), gemdraught grade, end mode or cutoff, party
    buffs, downtime, and custom burst windows.
-   **Compare** (`ui/ComparisonView.tsx`):
    -   Pick one to four configurations (A to D) and a baseline, each simulated with its own gear
        under one scenario.
    -   The picks, baseline, cutoffs, chart start and scenario are stored in a comparison document
        (below) and are undoable.
    -   `ΔDPS`/`Δ%` chart against the baseline, and a running-DPS chart, from a "Charts from" start
        (default 10 s). Each configuration has its own colour (validated for colour blindness), line
        pattern and lettered label.
    -   Cutoff table: DPS, `ΔDPS`, `Δ%` and rank. Default cutoffs every 30 s plus the end of the fight,
        editable. Totals and gauges in a collapsible table below it.
    -   Damage per burst window and its difference from the baseline; windows are `(start, end]`,
        like cutoffs.
-   **Persistence:** JSON workspace in `localStorage`, export/import as a file, schema migrations.

## 4. Architecture map

All Rotation Lab code is in `src/RotationLab/`; its tests are `src/__test__/rotationLab*.test.ts(x)`.

| Area              | Files                                                                                           | Notes                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine seam       | `src/Game/SimulationHost.ts`, `GameState.host`, `getGameState(config, host)`                    | Each simulation reports to its own host, not the global `controller`                                                                                     |
| Simulation        | `simulation/RotationSimulator.ts`, `RecordingHost.ts`, `types.ts`                               | One GameConfig + GameState + host per run. `simulateRotation()` wraps it, including the pull re-anchor                                                   |
| Encounter rules   | `rules/encounterRules.ts`                                                                       | Pull rule, downtime target rule (on when `encounterRules: true`; always on for editor scenarios)                                                         |
| Resource tracking | `rules/resourceTracking.ts`                                                                     | Per-job gauges, timers (with icons) and combos with finishers, for row snapshots and combo-break notes                                                   |
| Damage            | `damage/DamageModel.ts`                                                                         | xivgear formulas; verified for VPR at levels 80/90/100 only                                                                                              |
| Documents         | `models/Rotation.ts`, `Scenario.ts`, `GearSet.ts`, `Comparison.ts`, `validation.ts`             | `SCHEMA_VERSION` 5 (workspaces have `comparisons`); `AVAILABLE_RULESETS` (reborn `reborn-dt-2`)                                                          |
| Targets           | `rules/targets.ts`                                                                              | Effective ranges (overlaps resolved), enemies at a time, lowest count from press to landing                                                              |
| Storage           | `storage/WorkspaceStore.ts`, `storage/migrations.ts`                                            | Each migration keeps a backup under `rotationLab.workspace.v<old>`                                                                                       |
| Recommendations   | `recommend/context.ts`, `recommender.ts`, `vpr.ts`                                              | Shared context (legality, timers, weave slots) and `arrange` (slot fitting); one ruleset per job registered in `recommender.ts`. Rules: `docs/rulesets/` |
| Cache             | `simulation/SimulationManager.ts`                                                               | LRU keyed by job, ruleset, steps and the merged options (`rotationOptions`: scenario + resolved gear + the rotation's targets)                           |
| Editor logic      | `editor/rotationEdits.ts`, `history.ts`, `clipboard.ts`, `paletteState.ts`, `buffLanes.ts`      | Pure and unit-tested                                                                                                                                     |
| Comparison        | `comparison/compare.ts`, `baseline.ts`, `competitive.ts`, `cutoffs.ts`, `curves.ts`, `burst.ts` | Pure: cumulative series, baseline deltas and rank, competitiveness, default cutoffs, chart curves, burst tables, gauges at cutoffs                       |
| xivgear import    | `import/xivgear.ts`                                                                             | `api.xivgear.app/fulldata?url=<link>`                                                                                                                    |
| UI                | `ui/*.tsx`, `ui/RotationLab.css`, `ui/main.tsx`                                                 | Page entry `rotation-lab.html`, a second Vite input                                                                                                      |

## 5. Engine facts and pitfalls

-   **Circular imports:** any new browser entry must import `Components/Main` first (see
    `ui/main.tsx`); otherwise the page is blank with a TDZ error on `resourceInfos`. Vitest and the
    production build do **not** reproduce this, only the dev server does. Check new pages or new
    engine imports with `tools/dev-load/` (section 8).
-   **Host:** never reference `controller` in a GameState field initializer. `GameState.host`
    defaults lazily to the controller.
-   **Globals still left:** potencies created in non-VPR job files, `new Buff(type)` without a job,
    `DamageStatistics.ts` and `Record.ts` party-buff helpers still read the global controller. The
    Viper path has none. DRG's job file has no direct controller calls.
-   **Configs:** `DEFAULT_CONFIG` is Black Mage's; use `makeDefaultConfig(job)`.
-   **Party buffs** are active at both ends of their window (`GameState.getPartyBuffs`: `time ≤ t ≤
time + duration`) and snapshot at press time.
-   **FPS tax:** upstream rounds each GCD up to whole frames at 60 fps (2.12 s → 2.133 s).
    `XIVMath.afterFpsTax(0, x)` returns `x`; scenarios default to `fps: 0`. Raw `simulateRotation`
    keeps 60 fps so parity tests match upstream.
-   **Engine edits made by the Lab** (all small, upstream tests green):
    -   host seam (session 1);
    -   `XIVMath.afterFpsTax` fps 0;
    -   `VPR.ts processCombo`: Steel Maw and Reaving Maw used while untargetable do not start the AoE
        combo but cancel the single-target combo;
    -   `Potency.getAmount` / `ActionNode.getPotency` option `bossDebuffsOnPrimaryOnly` (session 5,
        off by default, the Lab always passes it): Chain Stratagem and Dokumori apply to the primary
        target of a multi-target hit only. Upstream applies every party buff to every target.
-   **Multi-target damage:** the engine already scales a hit by `1 + (1 − falloff) × (n − 1)` from
    the node's target list (`Potency.#getAmountWithModifiers`) and cuts skills without `falloff`
    to one target (`GameState.useSkill`). The Lab only builds the target list at the press.
-   **Formatting:** `npm.cmd exec -- prettier-no-jsx-parens -w <paths>`. Never plain `prettier`
    (npx fetches stock prettier, which reformats JSX differently).
-   **Git:** not on PATH; use `%LOCALAPPDATA%\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe`
    for read-only checks.
-   **Locale:** numbers are formatted in the user's locale (German: `2,50`). Tests compare against
    `formatNumber`, not literal strings.
-   **Clipboard:** browsers send copy/cut/paste to `document.body` when no text is selected, and
    Firefox may fire no paste event at all; `RotationTable` handles both.

## 6. Game rules confirmed by the user

The Lab applies these rules (with `encounterRules`), beyond what XIV in the Shell does:

-   **Pull:** the first damaging action's damage lands at exactly 0 s, whatever the clock says when
    it is pressed. If it would land late, the countdown is lengthened instead
    (`countdownExtension`). Non-damaging pre-pull actions (e.g. a tincture at −5 s) stay in place.
-   **Downtime:**
    -   Actions needing a target are invalid: damaging single-target actions plus Feint, Leg Sweep
        and Slither. Arm's Length is self-cast and allowed.
    -   Usable in downtime, with no damage: player-centred AoEs (Steel/Reaving Maw, Hunter's and
        Swiftskin's Bite, Jagged/Bloodied Maw, Last Lash, Vicepit, both Dens, Twinfang and Twinblood
        Thresh) and Reawaken, which still enters Reawakened. Reawaken's follow-ups (Generations,
        Legacies, Ouroboros) need a target.
    -   Vicepit grants the Dens but no Rattling Coil (upstream).
    -   A Maw in downtime does not start the AoE combo but cancels the single-target combo.
-   **Ghosting:** an action pressed before downtime that lands inside it keeps its effects but deals
    no damage. The note shows by how much it ghosted (landing − downtime start).
-   **Combos:** the Fang and Maw combos are mutually exclusive; starting one cancels the other.
    Combo breaks are noted. A combo that just times out is not reported (not requested).
-   **oGCD placement:** an optional per-step delay, counted from when the action first becomes usable
    (normally the end of the previous animation lock). "Clipped" means the oGCD right before a GCD
    pushed it past its ready time.
-   **Damage:** Viper is Dexterity, jobmod 110, weapon delay 2.64 (editable per gear set), no trait.
    Gemdraught is +10 % main stat, capped by grade.
-   **Recommendations:** the agreed rules live in `docs/rulesets/vpr-recommendations.md` (section 7
    has the user's answers of session 4: 2 weave slots, follow-up groups stay together, Rule 1 means
    the next GCD that refreshes the buff). Recommendation rules are advice, versioned in those docs,
    not in `AVAILABLE_RULESETS`.
-   **Gear import:** xivgear substats include food; the main stat is taken before party bonus and
    potion (the Lab applies those). A sheet link imports every set as its own gear set.
-   **Targets** (agreed in session 5; `rules/targets.ts`):
    -   Count only, no individual enemies. The main target is always there (outside downtime); there
        are no adds-only phases. Ranges are per rotation, so different action orders can be compared
        against different layouts.
    -   A range is the **total** number of enemies (2–16), from `start` (included) to `end`
        (excluded), in seconds from the pull, entered as decimals. Touching ranges are fine; an overlap
        is `start < previous end`. Overlaps and empty ranges are shown per row but do not stop the
        simulation: the range that starts first wins, empty ones are ignored.
    -   An action hits an extra enemy only if it was present at the **press** and still present when
        the damage **lands**: the count is the lowest one in between. (Pressed at 39.6 s, adds from
        40.0 s, landing at 40.4 s: one target, no damage event was ever queued for the adds.)
        Resources and combos come from the press as always.
    -   Single-target actions always hit 1. AoE falloff comes from the engine's skill data.
    -   Single-target party debuffs (Chain Stratagem, Dokumori) apply to the main target only; party
        buffs on the player apply to every target.
    -   The table column shows the enemies actually hit, only when more than 1.
    -   Recommendations: the AoE family at 3 or more, counted the same way for the next press of its
        first step.
    -   Ranges overlapping downtime are ignored there (nothing can be hit). The user may revisit
        shared-downtime scenarios after more tests.
    -   DoT ticks on an enemy that has left must stop. Not implemented: Viper has no DoT, so this waits
        for Dragoon (Chaotic Spring). Until then a DoT keeps ticking on every enemy its application hit.

## 7. Open work

Ordered roughly by the user's priorities. Discuss each with the user before starting.

1. **Recommendations:**
    - Viper is implemented (session 4). The user reviewed it in the browser and confirmed the
      interpretation choices in section 8 of the Viper ruleset doc, except the burst window.
    - Viper burst window (agreed with the user in session 6; ruleset doc section 4): a burst can
      hold two Reawakens (one from Ire, one from gauge, either order). A Reawaken counts if cast up
      to 30 s after an Ire or up to 15 s before one, and up to 3 GCDs between Reawakens keep the
      window open. Implemented as `viperBurstGap` in `recommend/vpr.ts`. The recommender only looks
      back, so Vicewinder is held for 3 GCDs after a burst Reawakened even if no second Reawaken
      follows. Awaiting the user's browser check of this change.
    - Golden replay tests: postponed by the user until after another feature. Ask for an opener
      and a 2-minute cycle for each job then.
    - Dragoon: implement `docs/rulesets/drg-recommendations.md` as `recommend/drg.ts` on the same
      context. `arrange` already handles weave slots (Stardiver: `slots: 2`). It needs DRG resource
      tracking (open work 4) only for the UI, not for the rules.
2. **Targets:** implemented in session 5 (rules in section 6). Still open:

    - DoT ticks stopping when their enemy leaves (with Dragoon).

    Done in session 6: the user's browser review of the Targets panel and column. Decided: a
    step's own `targets` (from upstream imports) is ignored by the simulator; the rotation's target
    ranges are the only source. The field stays on `RotationStep` so stored documents still parse.

3. **Comparison system (M0–M3 and M3a done, M3b and M4–M8 not started):** the locked design is in
   `docs/comparison/COMPARISON_SPEC.md` (N configurations vs a baseline, cutoff and fight-specific
   modes, burst/drift/resource analysis, provenance snapshots). The gap analysis is
   `COMPARISON_AUDIT.md` and the milestone plan `COMPARISON_ROADMAP.md` (MVP = M0–M3). All spec
   questions are decided (section 6); each later milestone awaits the user's go-ahead. Today's
   comparison is the N-way view described in section 3.
   **Plan approved 2026-11-05** (M3 is implemented; the suggested next step is M3b, awaiting the
   user's go-ahead).
   `comparison-design-spec.md` is the UI/metric baseline; the roadmap's "Reconciliation" section maps it
   to the code and adds M3a (exact competitiveness/regret maths), M3b (its UI, local sensitivity,
   schema 6) and M6b (event timeline). Decisions: no weighted potency (burst = party-buffed expected
   damage), no mode field, no per-configuration gear override (duplicate the rotation), one-configuration
   comparisons allowed, ε 0.10% (0.01–1.00, step 0.01), overcap and missed uses shown as observed counts
   (CS Q9, definitions confirmed at M6, which becomes engine-adjacent).

    - M0 changed `totalBetween` from `[start, end]` to `(start, end]` (spec Q1). The old assertion
      in `rotationLabCompare.test.ts` changed from 1110 to 1100, with a note on the test. The burst
      table now gives a hit exactly on a shared boundary to the window ending there.
    - Decided by the user after M0 (spec Q1): `compare.ts` treats times within 1e-6 s as the same
      instant, because landing times carry float noise (7.500000000000002 for a hit due at 7.5; the
      pull hit was off 0 by up to 3.6e-15 s in 24 of 216 measured runs). A window starting at 0 s
      includes the pull hit, and one ending at 0 s does not, so adjacent windows never double count.
    - Still raw floats: the engine's downtime check, kept for upstream parity (audit section 2).
    - M1 stores comparisons in `Workspace.comparisons` (schema 5; the migration creates none). What
      later milestones should know:

        - Until its first edit the view shows an unsaved default (current rotation against the next
          of its job). Opening Compare therefore adds no undo step, and undoing the first edit
          falls back to the default. Once stored, A and B no longer follow the current rotation.
        - `burstWindows` on the document is validated and round-tripped but not read: the editor
          still writes `ScenarioDocument.burstWindows`, and moving them is M5's listed change (the user confirmed waiting).
        - In Compare, the header scenario picker and "Copy scenario" change the comparison's own
          scenario. Edit mode keeps its own selection.
        - Deleting a rotation removes its configurations. Since M3 a comparison is deleted only with
          its last configuration; the confirm dialog says so, and undo restores it.
        - Validation is cross-document (`parseComparisonDocument(input, references)`): a comparison
          whose rotation or scenario was skipped on load is skipped and reported.
        - No UI yet to create, rename or delete comparisons (the user is fine with that for now); a selector appears with two or more.

    - M2 added `comparison/baseline.ts` (pure, not yet used by the UI): `compareConfigurations`
      (per cutoff: total, DPS, deltaDps, deltaPct, rank) and `deltaDpsSeries` (deltaDps at every
      event time plus extra times). Choices made there, for M3 to rely on:

        - At t <= 0 only the total is set; DPS, delta and rank are undefined.
        - The baseline row has deltaDps exactly 0; deltaPct is undefined for every row when the
          baseline DPS is 0 (including the baseline's own).
        - Ties share the best rank (1, 1, 3), compared with a relative 1e-9 tolerance.
        - Samples at event times suffice for extremes: between events deltaDps is monotonic.
        - Switching the baseline changes only the delta columns, never a configuration's own DPS.

    - M3a added `comparison/competitive.ts` (pure, not yet used by the UI): `intervalAnalysis` takes
      `(series, ids, T1, T2, epsilonPct)` and gives leader and competitive coverage, maximum and mean
      regret, the constant-total pieces and the competitive-set changes; `deltaPctSeries` joined `baseline.ts`,
      which now also exports `TIE_TOLERANCE` and `rankOf`. Choices made there, confirmed by the user on 2026-11-05, for M3 and M3b to rely on:

        - All results are fractions; only the `epsilonPct` argument is in percentage points (0.10 = 0.10%).
          Multiply by 100 at display.
        - Competitiveness is against the current best and takes no baseline at all.
        - Leaders are rank 1 as in the cutoff table and are always competitive. A gap of exactly ε
          is competitive (`TIE_TOLERANCE` slack on that comparison).
        - The last piece is a zero-length one at T2: a hit landing at T2 counts for maximum regret
          and transitions, as the cutoff table at T2 would show it, but not for coverage or mean regret.
        - A landing within 1e-6 s of T1 is part of the state at T1, so it is not a transition. The set
          at T1 is `pieces[0].competitive`.
        - All-zero totals: all entries tie as leaders and are competitive; DPS regret is 0 and
          `regretFraction` is undefined (N/A).
        - Known edge: below 1 DPS, `rankOf`'s tolerance is absolute, so a tie between totals differing
          by under 1e-9 × t could in theory end inside a piece, and the analysis uses the state at the
          piece's start. Real gaps between hits are far larger, and float noise far smaller.

    - M3 moved the UI to N configurations; the roadmap's M3 "As built" lists every choice. For later
      milestones:

        - An empty `cutoffs` means every 30 s (`comparison/cutoffs.ts`, spec Q7) and follows the fight's
          length. The first add or remove stores the list as shown. Removing the last stored cutoff
          therefore brings the default back.
        - `compareRotations`, the lead changes list and the whole-second sampling are gone. M3b's
          transition annotations replace the list.
        - Chart lines come from `comparison/curves.ts`, which gives the value before and after each hit.
          Its y-range needs those lows, which `deltaDpsSeries` does not sample. Hover values use
          `cutoffTable`, the table's own calculation.
        - A configuration's letter, colour and pattern come from its position in the document.
        - The visual review is the user's. It found that `.rl-table th` (sticky, `top` 40 px) comes later
          in `RotationLab.css` and so beat the old `.rl-compare-table th` override: inside
          `.rl-table-scroll` the headers then covered the first rows. The override now uses two classes.
          jsdom cannot catch this; only a browser check does.

    Comparison extras that stay open:

    - optionally an "expired combo" note;
    - a different UI for buff lanes, which the user may revisit.

4. **Dragoon:**
    - add damage-model constants (jobmod, delay, trait) from xivgear;
    - parity tests like Viper's;
    - resource tracking;
    - DRG's own raid buffs (Battle Litany) must come from the rotation, not fixed scenario
      windows; check how upstream does it first.
5. **Evolved ruleset** once Evercold mechanics are published (`AVAILABLE_RULESETS.evolved`).
6. **Proper fix for the circular imports**, e.g. a type-only `BLMState` import in `Resources.ts`.
   This is an engine change.
7. **Codebase reduction** (only VPR/DRG are needed). Not urgent:
    - Other jobs' tests protect shared engine code. Keep them until VPR/DRG tests cover casts,
      DoTs, autos, charges and party buffs.
    - Party-buff definitions in `Game/Buffs.ts` reference other jobs' IDs and must stay valid.
    - Remove jobs in one dedicated commit; remove the upstream timeline UI only once nothing
      depends on it (`Record.ts`, `Controller.ts`, `DamageStatistics.ts` are imported by the engine).

Known limitations:

-   Expected damage is VPR-only at levels 80/90/100; other jobs and levels report potency.
-   Gauges at a cutoff are those after the last action pressed before it.

## 8. Verification

-   **Tests:** `npm.cmd exec -- vitest run src/__test__/rotationLab` while iterating, then the full
    `npm.cmd exec -- vitest run` once. Also `npm.cmd run typecheck` and
    `npm.cmd exec -- eslint src/RotationLab`. Run Vitest from PowerShell: from Git Bash every suite
    failed at `describe` with "reading 'config'" (seen in M1; exact cause not investigated).
-   **Dev-server page check** (after adding engine imports to the page, or a new entry point):
    start a second server with `npm.cmd exec -- vite --port 3100 --strictPort` in the background,
    then run `node tools/dev-load/dev-load.mjs C:\Dev\rotation_planner http://localhost:3100 /src/RotationLab/ui/main.tsx`
    **from PowerShell**. The root must be an absolute path (Node 26 rejects `.`), and Git Bash
    rewrites the `/src/...` argument into a Windows path.
    It loads the page's native ES modules in Node with jsdom and prints `errors: none` plus the
    start of the rendered text. Stop the server afterwards. The user's own server on port 3000 is
    never touched.
-   **Visual review:** ask the user to check new UI, especially charts. Claude has a restricted
    Playwright MCP (localhost:3000 only) for occasional quick checks; see CLAUDE.md "Tools and Skills".
-   **Parity:** `rotationLabSimulator.test.ts` and `rotationLabEncounter.test.ts` compare against the
    real controller; the upstream VPR opener totals must stay exact. `rotationLabWorkbook.test.ts`
    cross-checks damage against the 7.2 workbook in `reference/`. That workbook is historical: don't
    assume its values for newer patches, and estimate the token cost before reading it (its sheets
    are large).
-   **Reference repo** for formulas and the xivgear API: the local clone `C:\Dev\gear-planner`
    (the xivgear author permits reuse). Search it locally.
