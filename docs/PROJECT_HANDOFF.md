# Project Handoff: FFXIV Viper Rotation Lab

Current state of the project for a new Claude Code session. Read this after `CLAUDE.md`.
Last updated 2026-11-03 (session 4: Viper recommendations).

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

## 3. Current state (verified 2026-11-03)

-   Branch `feature/rotation-lab`. Full suite: 41 files, 290 passed + 9 expected-fail (upstream
    `it.fails`). `tsc --noEmit`, ESLint and the dev-load page check clean (session 5).
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
    -   Pick rotations A and B, each simulated with its own gear under one scenario.
    -   Running-DPS chart (A blue, B orange; palette validated for colour blindness), DPS-lead chart,
        a "Charts from" start (default 10 s).
    -   Cutoff table: DPS, totals and gauges per rotation; any number of cutoffs.
    -   Lead changes and damage per burst window.
-   **Persistence:** JSON workspace in `localStorage`, export/import as a file, schema migrations.

## 4. Architecture map

All Rotation Lab code is in `src/RotationLab/`; its tests are `src/__test__/rotationLab*.test.ts(x)`.

| Area              | Files                                                                                      | Notes                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine seam       | `src/Game/SimulationHost.ts`, `GameState.host`, `getGameState(config, host)`               | Each simulation reports to its own host, not the global `controller`                                                                                     |
| Simulation        | `simulation/RotationSimulator.ts`, `RecordingHost.ts`, `types.ts`                          | One GameConfig + GameState + host per run. `simulateRotation()` wraps it, including the pull re-anchor                                                   |
| Encounter rules   | `rules/encounterRules.ts`                                                                  | Pull rule, downtime target rule (on when `encounterRules: true`; always on for editor scenarios)                                                         |
| Resource tracking | `rules/resourceTracking.ts`                                                                | Per-job gauges, timers (with icons) and combos with finishers, for row snapshots and combo-break notes                                                   |
| Damage            | `damage/DamageModel.ts`                                                                    | xivgear formulas; verified for VPR at levels 80/90/100 only                                                                                              |
| Documents         | `models/Rotation.ts`, `Scenario.ts`, `GearSet.ts`, `validation.ts`                         | `SCHEMA_VERSION` 4 (rotations have `targets` ranges); `AVAILABLE_RULESETS` (reborn `reborn-dt-2`)                                                        |
| Targets           | `rules/targets.ts`                                                                         | Effective ranges (overlaps resolved), enemies at a time, lowest count from press to landing                                                              |
| Storage           | `storage/WorkspaceStore.ts`, `storage/migrations.ts`                                       | Each migration keeps a backup under `rotationLab.workspace.v<old>`                                                                                       |
| Recommendations   | `recommend/context.ts`, `recommender.ts`, `vpr.ts`                                         | Shared context (legality, timers, weave slots) and `arrange` (slot fitting); one ruleset per job registered in `recommender.ts`. Rules: `docs/rulesets/` |
| Cache             | `simulation/SimulationManager.ts`                                                          | LRU keyed by job, ruleset, steps and the merged options (`rotationOptions`: scenario + resolved gear + the rotation's targets)                           |
| Editor logic      | `editor/rotationEdits.ts`, `history.ts`, `clipboard.ts`, `paletteState.ts`, `buffLanes.ts` | Pure and unit-tested                                                                                                                                     |
| Comparison        | `comparison/compare.ts`                                                                    | Pure: cumulative series, DPS samples, lead changes, burst windows, gauges at cutoffs                                                                     |
| xivgear import    | `import/xivgear.ts`                                                                        | `api.xivgear.app/fulldata?url=<link>`                                                                                                                    |
| UI                | `ui/*.tsx`, `ui/RotationLab.css`, `ui/main.tsx`                                            | Page entry `rotation-lab.html`, a second Vite input                                                                                                      |

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
    - Viper is implemented (session 4). The user still has to review it in the browser, and the
      interpretation choices in section 8 of the Viper ruleset doc need their confirmation.
    - Golden replay tests: postponed by the user until after another feature. Ask for an opener
      and a 2-minute cycle for each job then.
    - Dragoon: implement `docs/rulesets/drg-recommendations.md` as `recommend/drg.ts` on the same
      context. `arrange` already handles weave slots (Stardiver: `slots: 2`). It needs DRG resource
      tracking (open work 4) only for the UI, not for the rules.
2. **Targets:** implemented in session 5 (rules in section 6). Still open:
    - the user's browser review of the Targets panel and the table column;
    - DoT ticks stopping when their enemy leaves (with Dragoon);
    - a step's explicit `targets` (from upstream imports) still overrides the ranges. That is
      harmless for Viper, but decide whether the Lab should ignore it.
3. **Comparison extras:**
    - persist cutoffs and the chart start time;
    - compare more than two rotations;
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
-   Comparison settings reset on reload.

## 8. Verification

-   **Tests:** `npm.cmd exec -- vitest run src/__test__/rotationLab` while iterating, then the full
    `npm.cmd exec -- vitest run` once. Also `npm.cmd run typecheck` and
    `npm.cmd exec -- eslint src/RotationLab`.
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
