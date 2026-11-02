# Project Handoff: FFXIV Viper Rotation Lab

**Project:** FFXIV Rotation Planner / Rotation Lab  
**Handoff date:** November 2, 2026  
**Development environment:** Windows 11 / Windows PC, PowerShell, VS Code  
**Primary language:** TypeScript  
**Status (updated 2026-11-02, Claude Code session 1):** Headless, isolated Viper simulation implemented and verified against the original controller. Potency only; expected damage not yet implemented.

---

# 0. Current Status Summary (read this first)

Sections 1–28 below preserve the original handoff. Where a section was wrong or has been superseded, it has been corrected in place or marked **[Updated]**.

## 0.1 Verified state

- Branch `feature/rotation-lab`. Remotes: `origin` = https://github.com/RhyTamok/rotation_planner.git, `upstream` = https://github.com/xivintheshell/xivintheshell.git.
- Full suite: 28 files, **150 passed + 9 expected-fail** (upstream `it.fails` cases). `tsc --noEmit` and ESLint clean. Baseline before session 1 changes: 26 files, 135 passed + 9 expected-fail.
- The user confirmed the app still works at http://localhost:3000/ after the engine changes.

## 0.2 What session 1 found

1. **Damage resolution went through the global controller.** `GameState` called `controller.resolvePotency(p)`, which stamps `p.resolve(controller.game.getDisplayTime())`. That uses the *controller's* clock and writes into the global timeline. Measured: one Steel Fangs in a "headless" Viper state wrote 3 elements into the global timeline (whose game was BLM) and was stamped at −5.0s instead of the Viper game's time. The original four isolation tests did not check for this.
2. More global coupling than the original handoff listed: Viper's Vicepit coil gain and auto-attacks read `controller.timeline` downtime. Party buffs come from `controller.timeline` buff markers. `Resources.ts` stamped expirations with `controller.game`. `Potency.ts` read `controller.gameConfig` for auto-crit/auto-CDH. `Buffs.ts` reads `controller.game.job`.
3. `DEFAULT_CONFIG` is **Black Mage's** default config. `{...DEFAULT_CONFIG, job: "VPR"}` simulates Viper with BLM stats. Use `makeDefaultConfig("VPR")`.
4. Upstream already had a usable oracle: `src/__test__/VprRotations.test.ts`, the `utils.ts` harness, and `src/__test__/Asset/vpr_100_opener.txt` with known totals.
5. Upstream totals (`calculateDamageStats`) are **potency** totals that include auto-attacks. Crit/DH are folded in only as relative multipliers. Main stat and weapon damage are not used. This confirms the suspicion in section 6.
6. `GameState.tick()` stops early when the event queue is empty. The controller does not compensate, and the simulator mirrors this.

## 0.3 What session 1 implemented

**Engine seam (behavior-preserving):**
- `src/Game/SimulationHost.ts`: interface for everything a GameState reports or asks of its environment. The global `Controller` satisfies it structurally.
- `GameState.host` is set via `getGameState(config, host?)` and defaults lazily to the global controller. It must stay lazy: the controller constructs a GameState while its own module is still loading.
- `GameState.ts`, `Jobs/VPR.ts` and `Jobs/RoleActions.ts` call `this.host` / `state.host` instead of `controller`.
- `Resources.ts`: each Resource knows its owning game.
- `Potency.ts`: auto-crit/CDH use `this.config`, matching the adjacent no-CDH branch.
- DoT potencies use the game's own config. All other potency sites already did.

**Rotation Lab simulator (`src/RotationLab/simulation/`):**
- `RotationSimulator`: owns GameConfig + GameState + `RecordingHost`. It mirrors `Controller.#useSkill` in manual mode: wait until available, conditional replacement, re-check, target filtering, `useSkill` or `useInvalidSkill`, then fast-forward through the animation lock.
- Steps: skill, `wait` (seconds), `jumpTo` (display time).
- End modes: `"lastAction"` (matches upstream), `"settled"` (all action damage landed), or a numeric fight cutoff.
- Invalid actions follow the upstream replay policy: kept, flagged, locks rolled, simulation continues, `result.valid = false`.
- `simulateRotation(input, options)` is a convenience wrapper.
- All times are engine display time in seconds.

**Tests:**
- `rotationLabHostIsolation.test.ts`: failed before the seam, passes after.
- `rotationLabSimulator.test.ts`: basics, invalid actions, cutoff, repeatability, A→B→A, interleaved simulators, global controller untouched, per-action parity with the real controller on four Viper sequences, and the opener regression (18 GCDs, 18316 potency without pot, 19494.32 with 8% pot, 187 pending).

## 0.3b Session 2: expected damage

- **Formulas:** `src/RotationLab/damage/DamageModel.ts` reimplements xivgear's xivmath with the same rounding order. Source: https://github.com/xiv-gear-planner/gear-planner; the author is a friend of the user and reuse is permitted. A local clone is at `C:\Dev\gear-planner`.
- **Damage chain** (physical, non-caster): ⌊⌊⌊⌊⌊⌊potency × fAP⌋ × fDET⌋ × fTNC⌋ × fWD⌋ × fSPD⌋ × trait⌋, plus 1 if potency < 100.
  - fSPD applies only to DoTs and auto-attacks.
  - Auto-attacks use fAUTO = ⌊⌊440 × jobmod/1000 + WD⌋ × delay/3⌋ / 100 and auto potency 90.
- **Main stat:** ⌊raw × (1 + party bonus %)⌋.
- **Gemdraught:** +10% main stat, capped at 351/392/461/541 for grades 1–4. It enters fAP for hits that snapshotted under it.
- **Combining with the engine:** expected damage per hit = floored chain on the hit's potency (base + combo/positional adders) × (engine potency amount ÷ that potency, which covers personal buffs and buff-driven crit/DH changes) × the character's expected crit/DH multiplier.
  - Buffs are applied unfloored after the chain, as xivgear does. The difference from in-game flooring is under 1 damage per hit.
  - Auto-attacks are rebuilt from the unscaled potency of 90, because the engine's auto base is already skill-speed scaled.
- **Verified constants:** levels 80/90/100. VPR only: Dexterity jobmod 110 (confirmed by the user), no damage trait, weapon delay 2.64.
- **Weapon delay** is editable per simulation (`options.weaponDelay`). It drives both auto-attack damage and frequency through a new, behavior-preserving `GameState.setWeaponDelay()`.
- **Tincture:** the potency fields still use XIV in the Shell's flat `tincturePotencyMultiplier`, for upstream parity. Expected damage uses `options.tinctureGrade`, default 4.
- **Results:** per-action `expectedDamage` / `pendingDamage`, per-event `expectedDamage`, and `result.damage` with `expectedDamage`, `autoAttackDamage`, `pendingDamage` and `expectedDps`. DPS = damage landed ÷ end time, measured from the pull.
- **Tests:** `rotationLabDamage.test.ts`, 13 tests. Formula values are hand-computed from the xivgear code for the default Viper level 100 config.
- **Cross-checked against the 7.2 workbook** (`rotationLabWorkbook.test.ts`).
  - The per-hit damage column `AL` of "Planner (with sample)" reproduces exactly with **jobmod 110**: WD multiplier 1.94 for WD 146; main 4861 with 5% party bonus → main-stat multiplier 26.12; det 1.098; crit 24.8% / 1.598; DH 28.1%.
  - Column `AM` hard-codes jobmod 100 but is unused (empty in action rows).
  - The sheet truncates potency × fAP × fDET in one step, floors the expected crit multiplier to 3 decimals, and truncates after crit, DH and each buff. Our results therefore land 0.02–0.05% above the sheet. Pre-crit values match exactly where both rounding orders agree.
  - **The sheet uses weapon delay 2.56**, which is Ninja's delay; the sheet was originally built from a Ninja template. Its auto-attack value (5754) reproduces exactly with 2.56. **Viper's correct delay is 2.64**, confirmed by the user, and that is the Rotation Lab default. Do not "fix" it to match the sheet.
  - The workbook planner sheet is 17 MB. To read it, stream with an XmlReader over the extracted `xl/worksheets/sheet2.xml` and only the needed rows/columns; never dump it.
- **DoT approximation:** the engine's DoT tick potencies are already speed scaled, so DoT ticks are treated as direct hits. The flooring position of fSPD is therefore approximate. VPR has no DoTs; revisit for DRG's Chaos Thrust.

## 0.3c Session 2: party buffs and downtime

- **Simulation options:**
  - `partyBuffs: { buff: BuffType, time, duration? }[]`. Duration defaults to the buff's standard duration.
  - `downtime: { start, end }[]`, with an exclusive end; invalid windows throw.
  - All times are display time.
- `RecordingHost` serves these windows through `timeline.getBuffMarkers / duringUntargetable / nextTargetableAfter`, with the same semantics as the upstream `Timeline`.
- **Engine seam (behavior-preserving):**
  - `Potency` takes an optional `partyBuffSource`. `GameState` passes itself at all 8 of its potency construction sites.
  - `Potency.partyBuffsAt()` replaces the `controller.game.getPartyBuffs` reads in `Potency` and `ActionNode`.
  - `Buff` accepts the receiving job, which matters for AST cards; `GameState.getPartyBuffs` passes `this.job`.
  - `Record.ts` no longer imports the controller.
- **Simulator:**
  - Potency and damage include party buffs, except "without pot" potency, which excludes them as upstream does.
  - Hits landing in downtime count as zero (`hitTarget: false` on damage events), matching upstream with its untargetable mask on.
  - Auto-attacks pause during downtime (engine behavior via the host).
  - `result.assumptions` was replaced by `result.encounter`, which echoes the resolved windows.
- **Tests:** `rotationLabEncounter.test.ts`, 7 tests. Per-action parity with the real controller using `Timeline.addBuffMarkers` / `addMarker(Untargetable)`: start times, potency including masking, and auto-attack snapshot times. Also covers damage-multiplier and crit buffs, windows outside the snapshot, downtime masking, isolation, and validation.

## 0.4 Known limitations

- Expected damage only for VPR at levels 80/90/100 (section 0.3b).
- Party buffs are given as fixed windows. The job's own party buffs (e.g. DRG Battle Litany cast in the rotation) are not yet generated from the rotation itself; check how upstream handles this before adding DRG.
- Non-VPR job files still call the global controller directly. DRG has no direct controller calls.
- `DamageStatistics.ts`, `Record.ts` (party buff helpers) and `Buffs.ts` still use the global controller. Rotation Lab does not depend on them.

---

# 1. Instructions for Claude Code

You are taking over the development of a custom Final Fantasy XIV combat rotation planner.

The user has limited experience writing code but substantial knowledge of FFXIV combat mechanics, particularly Dragoon (DRG) and Viper (VPR), including damage formulas, cooldowns, resources, and rotational optimization.

Your role is to act as an experienced TypeScript/React developer, simulation engineer, and technical mentor.

## Working principles

1. Inspect the actual repository and relevant source files before changing existing code.
2. Preserve functioning combat mechanics wherever possible.
3. Prefer extending or refactoring existing systems rather than duplicating the simulation engine.
4. Implement complete, runnable solutions rather than pseudocode or incomplete snippets.
5. Explain significant architectural decisions in accessible language.
6. Make incremental, testable changes.
7. Run existing tests before and after changes.
8. Clearly distinguish verified engine behavior from assumptions.
9. Avoid unnecessary package upgrades or large refactors.
10. Keep simulation logic independent from React/UI components where possible.
11. Design for both current Viper mechanics and major upcoming job-system changes.
12. Prioritize correctness, speed, editability, and rotation comparisons over visual polish.
13. Ask for clarification when an important game mechanic is ambiguous, but make reasonable implementation decisions without unnecessary interruptions.
14. Preserve the ability to compare simulation results with the upstream XIV in the Shell implementation.
15. Maintain existing licensing and attribution requirements.

**Important:** The user wants to move from step-by-step terminal-based assistance to direct implementation using Claude Code. Inspect files, make changes, and run tests directly when the environment permits.

---

# 2. Project Vision and Motivation

## 2.1 Existing workflow

The user currently uses a Google Sheets-based Viper rotation planner.

The existing spreadsheet contains extensive combat calculations but becomes very slow when adding abilities, editing existing sequences, or constructing long rotations.

This creates unnecessary friction when evaluating different rotational decisions.

The user provided the existing planner as an Excel export:

`VPR 7.2 DT Planner v2.22.xlsx`

The file covers Viper mechanics from FFXIV patch 7.2.

It should be treated as a reference implementation and potential source of regression-test cases, not automatically as authoritative data for later game patches.

## 2.2 Main objective

Develop a fast, interactive, local, browser-based FFXIV rotation planner focused initially on Viper.

The application must make it easy to:

- Build long Viper rotations.
- Insert, delete, reorder, duplicate, and replace individual actions.
- Handle GCDs and oGCDs.
- Automatically calculate action timing.
- Simulate cooldowns, resources, combos, buffs, and other mechanics.
- Calculate potency and expected damage.
- Compare multiple rotational variants.
- Identify how damage differences develop over time.
- Save and load rotations.
- Support fundamentally different Viper combat modes in the future.

The emphasis is on improving the process of rotational theorycrafting rather than building a general-purpose game simulator.

## 2.3 Performance goals

The original Google Sheet is slow enough that long rotation construction becomes frustrating.

The new planner should feel responsive while editing rotations containing hundreds of actions.

Proposed performance targets, not yet validated:

- Immediate visual response to skill insertion and editing.
- Ideally less than 100 ms for routine deterministic recalculation of a several-minute rotation on a typical desktop PC.
- Avoid unnecessary recomputation of unchanged rotations.
- Avoid blocking the interface with expensive calculations.
- Introduce Web Workers or incremental simulation only if profiling demonstrates a benefit.

Do not prematurely optimize before establishing correctness and measuring actual performance.

---

# 3. Major Design Decision: Reuse XIV in the Shell

Rather than implementing FFXIV combat mechanics from scratch, the project will fork and modify the existing open-source simulator XIV in the Shell.

Original project:

https://github.com/xivintheshell/xivintheshell

Original web application:

https://xivintheshell.com/

The user likes the existing simulator's general approach to building rotations and simulating combat.

The primary shortcomings for the user's use case are:

1. The current user interface is not satisfactory.
2. It does not provide the desired multi-rotation comparison workflow.
3. The original developers may not implement future Viper combat-system changes quickly enough.

The fork is therefore intended to become an independently maintained application, not simply a cosmetic reskin.

## 3.1 Fork strategy

The project should retain the useful functionality of XIV in the Shell while allowing extensive changes to:

- User interface.
- Simulation orchestration.
- Damage statistics.
- Job-specific rules.
- Action data.
- Combat-mode support.
- Persistence.
- Rotation comparison.

The repository has previously been identified as MIT-licensed. Verify the actual LICENSE file in the checked-out revision and preserve required copyright/license notices.

The fork does not depend on approval or updates from the original developers.

An `upstream` remote can be maintained to selectively incorporate useful future changes, but automatic upstream merges are not a design requirement.

The extent of divergence will make future upstream merges progressively harder.

---

# 4. Future Requirement: Evercold, Reborn, and Evolved

The user expects a new FFXIV release called **Evercold** in February 2027.

According to the requirements supplied by the user:

- All jobs will receive a new **Evolved Mode**.
- The existing **Reborn Mode** will remain available initially.
- Evolved will fundamentally change some job mechanics.
- Evolved is expected to be slightly stronger.
- The primary theorycrafting focus should therefore be Evolved.
- Reborn must remain simulatable for comparison and job-analysis purposes.

The earlier conversation also mentioned February 23, 2027 as the release date and February 19 as an early-access date. These dates came from a previous assistant response and have not been independently reverified in this handoff. Treat them as provisional.

The detailed Viper Evolved mechanics are not yet established in the supplied project materials.

Do not invent future abilities, mechanics, or potencies.

## 4.1 Architectural requirement

Combat modes should be defined per rotation, not as one global setting.

Example:

| Rotation | Job | Mode |
|---|---|---|
| Traditional Opener | VPR | Reborn |
| Evolved Opener A | VPR | Evolved |
| Evolved Opener B | VPR | Evolved |
| Evolved Delayed Burst | VPR | Evolved |

Both modes must support comparison under consistent simulation conditions.

## 4.2 Proposed model

Use a shared combat simulation foundation while allowing different job-specific rule implementations.

Conceptually:

```text
Simulation Engine
|
+-- Shared Combat Mechanics
|   +-- GCD / Recast
|   +-- Animation Lock
|   +-- Cooldowns
|   +-- Damage Calculation
|   +-- Buffs / Debuffs
|   +-- Event Queue
|   +-- Timeline
|
+-- Viper Rules
    +-- Reborn
    |   +-- Actions
    |   +-- Combos
    |   +-- Resources
    |
    +-- Evolved
        +-- Actions
        +-- Combos
        +-- Resources
```

Illustrative interface:

```typescript
type CombatMode = "reborn" | "evolved";

interface JobRules<TState> {
  mode: CombatMode;

  createInitialState(): TState;

  getAvailableActions(state: TState): string[];

  executeAction(
    state: TState,
    actionId: string
  ): ActionExecution<TState>;
}
```

This interface is a conceptual proposal, not existing code.

Evolved should not merely override a few numerical values from Reborn. The architecture must permit different resource systems, state transitions, combos, and ability behavior.

Patch and ruleset versions should be persisted with saved rotations so balance updates do not silently alter the interpretation of historical results.

---

# 5. User Interface Requirements

## 5.1 Visual reference

The user's preferred UI reference is:

https://www.rubixbob.com/

The user particularly likes its approach to building Dragoon rotations.

The most important preference is a **vertical rotation layout**.

A primarily horizontal timeline is not ideal for this use case.

## 5.2 Proposed interface

The application should have two major modes.

### Editor Mode

A vertically scrolling rotation editor.

Suggested columns:

- Sequence number.
- Time.
- Skill icon.
- Skill name.
- GCD/oGCD indicator.
- Potency.
- Expected damage.
- Active buffs.
- Relevant job resources.
- Cooldown information.
- Errors and warnings.

Possible interaction features:

- Click an action in a skill palette to insert it.
- Keyboard shortcuts.
- Drag-and-drop reordering.
- Copy and paste actions or groups.
- Undo and redo.
- Duplicate actions.
- Insert an action at an arbitrary position.
- Remove an action without rebuilding the entire rotation.
- Automatic recalculation of subsequent action timing.
- Clear presentation of illegal actions.
- Automatic handling of conditional action replacements.
- Optional timeline visualization.

The first usable editor can remain relatively simple as long as it is fast and practical.

### Comparison Mode

Comparison of two or more saved rotations.

The initial MVP should support at least two rotation slots.

Eventually, two to four or more variants should be possible.

Required comparison metrics:

- Total expected damage.
- Average expected DPS.
- Effective potency.
- Damage over time.
- Cumulative damage curves.
- Damage at arbitrary kill times.
- Damage within selected burst windows.
- GCD uptime.
- Resource usage and overcap.
- Cooldown utilization.
- Differences between action sequences.
- Time at which one rotation overtakes another.

## 5.3 Comparison correctness

All comparisons should use explicitly defined, consistent conditions.

Examples:

- Character stats.
- Fight duration.
- Target count.
- Targetability/downtime.
- External buffs.
- Consumables.
- Starting resources.
- Relevant encounter conditions.
- Combat patch/ruleset version.

Do not compare two rotations under different assumptions without clearly displaying the differences.

The tool should handle rotations of different lengths correctly.

A shorter sequence must not obtain an artificial advantage merely because it omits later filler or downtime.

The comparison should support a common fight cutoff and calculate total expected damage up to that cutoff.

---

# 6. Damage Simulation Requirements

The initial implementation does not need a full Monte Carlo simulator.

**Deterministic expected damage is sufficient.**

The user already understands or can supply necessary FFXIV damage formulas, including relevant stat scaling and mechanics.

The system should eventually distinguish:

1. Raw potency.
2. Effective potency with relevant modifiers.
3. Expected actual damage incorporating character stats.
4. Expected DPS over a defined period.

Relevant components include:

- Base action potency.
- Combo-specific potency.
- Personal buffs.
- External raid buffs.
- Critical Hit.
- Direct Hit.
- Determination.
- Main stat.
- Weapon Damage.
- Skill Speed.
- Relevant damage multipliers.
- Game-specific rounding/floor operations.
- Auto-attacks.
- Damage application timing.
- Snapshot timing.
- Damage-over-time effects if relevant.
- Target count and falloff.
- Damage occurring after the final player action.

Accurate timing matters because buff snapshots and damage application may occur at different times.

**[Updated] Confirmed in session 1:** XIV in the Shell's damage statistics are potency totals. Crit, DH and determination enter only as relative multipliers through `XIVMath.calculateDamage` ratios, for buffs and auto-crit. Main stat and weapon damage are not used. Expected actual damage has to be added by Rotation Lab.

---

# 7. Existing Spreadsheet Resource

Uploaded workbook:

`VPR 7.2 DT Planner v2.22.xlsx`

The previous analysis identified four worksheets:

1. `README`
2. `Planner (with sample)`
3. `SkillDB`
4. `ValidationHelper`

Reported contents:

### README

Usage instructions and version information.

### Planner (with sample)

- Existing sample rotation.
- Character/stat configuration.
- Timing.
- Damage.
- Buffs.
- Resource management.
- Cooldowns.
- Auto-attacks.
- Calculations.
- Raid-buff configuration.

### SkillDB

- Skill definitions.
- Potencies.
- Recast times.
- Cooldowns.
- Animation locks.
- Other skill-related parameters.

### ValidationHelper

- Skill categories.
- Combo validation.
- Special-case logic.

This workbook should be analyzed directly and used to extract known-good rotation examples.

Important:

The workbook targets patch 7.2 and must not be assumed current for future patches.

It may nevertheless be useful for validating formulas and identifying edge cases.

The original Google Sheets document has not been directly connected to the new application.

---

# 8. Local Development Environment

The local setup is complete and functioning.

## 8.1 Operating system and tools

- Windows.
- Visual Studio Code.
- PowerShell integrated terminal.
- GitHub Desktop.
- Git for Windows was discussed as an alternative command-line Git installation.
- GitHub account.
- Node.js LTS.
- npm.
- React.
- TypeScript.
- Vite.
- Vitest.
- Firefox used to access the local web application.

GitHub Desktop is the recommended Git UI because the user has limited coding experience.

Git for Windows is not strictly required for basic GitHub Desktop workflows, since GitHub Desktop bundles Git.

## 8.2 Local repository location

```text
C:\Dev\rotation_planner
```

**[Updated]** Verified in session 1:

- `origin` = https://github.com/RhyTamok/rotation_planner.git
- `upstream` = https://github.com/xivintheshell/xivintheshell.git
- Working branch: `feature/rotation-lab`

`git` is not on PATH. Use GitHub Desktop's bundled binary, for example `%LOCALAPPDATA%\GitHubDesktop\app-3.6.1\resources\app\git\cmd\git.exe`. The version folder changes when GitHub Desktop updates.

## 8.3 Dependency installation

Command executed successfully:

```powershell
npm.cmd ci
```

Result:

```text
added 406 packages, and audited 407 packages in 28s
```

Additional output:

```text
npm warn deprecated whatwg-encoding@3.1.1
146 packages are looking for funding
14 moderate severity vulnerabilities
```

The 14 moderate findings were associated with a vulnerable version of `minimatch` and its dependent tooling, primarily in the ESLint ecosystem.

The suggested automatic fix involved potentially breaking dependency changes.

The user was advised NOT to run:

```powershell
npm audit fix --force
```

The production-only dependency audit was executed:

```powershell
npm.cmd audit --omit=dev
```

Result:

```text
found 0 vulnerabilities
```

This establishes that npm reported no known vulnerabilities within the production dependency tree at the time of the check.

It does not prove that development tooling is risk-free.

No forced package updates have been made or confirmed.

## 8.4 Local development server

Executed successfully:

```powershell
npm.cmd run start
```

Output:

```text
> xiv-in-the-shell@0.1.0 start
> vite & tsc --noEmit -watch

VITE v8.3.5 ready in 201 ms

Local: http://localhost:3000/
Network: use --host to expose
```

The application opens successfully in the browser.

The user confirmed:

- Localhost works.
- No browser console errors.
- No relevant terminal errors observed.

The working localhost URL is:

```text
http://localhost:3000/
```

The development server must remain running while using the application.

---

# 9. Existing Repository Structure

The user listed the immediate subdirectories of `src`:

```text
src/
├── Components/
├── Controller/
├── Game/
├── Manual/
├── Style/
└── __test__/
```

## 9.1 Game folder

Identified files:

```text
src/Game/
├── Buffs.ts
├── Common.ts
├── GameConfig.ts
├── GameState.ts
├── Potency.ts
├── Resources.ts
├── Skills.ts
├── XIVMath.ts
│
├── Data/
│   ├── Data.ts
│   ├── index.ts
│   ├── Jobs.ts
│   ├── types.ts
│   ├── Jobs/
│   │   ├── AST.ts
│   │   ├── BLM.ts
│   │   ├── BLU.ts
│   │   ├── BRD.ts
│   │   ├── DNC.ts
│   │   ├── DRG.ts
│   │   ├── DRK.ts
│   │   ├── GNB.ts
│   │   ├── MCH.ts
│   │   ├── MNK.ts
│   │   ├── NIN.ts
│   │   ├── PCT.ts
│   │   ├── PLD.ts
│   │   ├── RDM.ts
│   │   ├── RPR.ts
│   │   ├── SAM.ts
│   │   ├── SCH.ts
│   │   ├── SGE.ts
│   │   ├── SMN.ts
│   │   ├── VPR.ts
│   │   ├── WAR.ts
│   │   └── WHM.ts
│   └── Shared/
│       ├── Common.ts
│       ├── LimitBreak.ts
│       └── Role.ts
│
└── Jobs/
    ├── AST.ts
    ├── BLM.ts
    ├── BLU.ts
    ├── BRD.ts
    ├── DNC.ts
    ├── DRG.ts
    ├── DRK.ts
    ├── GNB.ts
    ├── index.ts
    ├── MCH.ts
    ├── MNK.ts
    ├── NIN.ts
    ├── PCT.ts
    ├── PLD.ts
    ├── RDM.ts
    ├── RPR.ts
    ├── RoleActions.ts
    ├── SAM.ts
    ├── SCH.ts
    ├── SGE.ts
    ├── SMN.ts
    ├── VPR.ts
    ├── WAR.ts
    └── WHM.ts
```

## 9.2 Controller folder

```text
src/Controller/
├── Clipboard.ts
├── Common.ts
├── Controller.ts
├── DamageStatistics.ts
├── ImageExportConfig.ts
├── KeybindManager.ts
├── PresetLinesManager.ts
├── Record.ts
├── Timeline.ts
└── UndoStack.ts
```

The analysis so far has focused on:

```text
src/Game/GameState.ts
src/Game/Jobs/index.ts
src/Game/Jobs/VPR.ts
src/Game/Data/Jobs/VPR.ts
src/Game/Skills.ts
src/Game/GameConfig.ts
src/Controller/Controller.ts
src/Controller/Record.ts
src/Controller/DamageStatistics.ts
```

---

# 10. Source-Code Architecture Findings

The following conclusions are based on code excerpts from the user's local repository, not on assumptions about how other versions of XIV in the Shell work.

## 10.1 Global Controller

File:

```text
src/Controller/Controller.ts
```

Around line 138:

```typescript
class Controller {
```

Around line 2639:

```typescript
export const controller = new Controller();
```

The current application therefore exposes a singleton controller instance.

The controller imports React and multiple UI components.

Examples:

```typescript
import React from "react";
import { updateStatusDisplay } from "../Components/StatusDisplay";
import { updateSkillButtons } from "../Components/Skills";
import { updateDamageStats } from "../Components/DamageStatistics";
```

The current controller combines:

- Simulation orchestration.
- User input.
- Recording.
- Replay.
- Timeline management.
- UI updates.
- Damage-statistics updates.
- Historical playback.
- Undo functionality.
- Skill availability.
- Miscellaneous presentation-related state.

This coupling is undesirable for a new headless multi-rotation simulation API.

## 10.2 Controller construction

Around lines 202–243:

```typescript
constructor() {
  this.timeScale = 1;
  this.shouldLoop = false;
  this.queuedPastes = 0;
  this.tickMode = TickMode.RealTimeAutoPause;

  // Other controller configuration...

  this.timeline = new Timeline();
  this.timeline.reset();

  this.#presetLinesManager = new PresetLinesManager();

  this.gameConfig = new GameConfig(DEFAULT_CONFIG);
  this.game = getGameState(this.gameConfig);

  this.record = new Record();
  this.record.config = this.gameConfig;

  // Additional initialization...

  this.undoStack = new UndoStack();

  this.#loadHotbarLayout();
  this.#requestRestart();
}
```

The controller creates a GameState through a factory function.

The same factory is used when restarting the simulation.

## 10.3 GameState factory

File:

```text
src/Game/Jobs/index.ts
```

Around line 26:

```typescript
export function getGameState(config: GameConfig): GameState {
```

For Viper:

```typescript
case "VPR":
  return new VPRState(config);
```

This provides a potential entry point for our custom simulation adapter.

Each call creates a new VPRState instance.

## 10.4 GameState initialization

File:

```text
src/Game/GameState.ts
```

Around line 123:

```typescript
constructor(config: GameConfig) {
  this.config = config;

  this.rng = seedrandom(config.randomSeed);
  this.nonProcRng =
    seedrandom(config.randomSeed + "_nonProcs");

  this.lucidTickOffset = this.nonProcRng() * 3.0;
  this.dotTickOffset = this.nonProcRng() * 3.0;
  this.hotTickOffset = this.nonProcRng() * 3.0;

  this.time = 0;

  this.resources = new ResourceState(this);
  this.debuffs = new DebuffState(this);
  this.cooldowns = new CoolDownState(this);

  // Initialization continues...
}
```

The following are instantiated separately for each GameState:

- Simulation time.
- Resource state.
- Debuff state.
- Cooldown state.
- Seeded RNG instances.

This is favorable for independent simulations.

However, it does not establish that every callback, registry, or calculation is instance-local.

## 10.5 Global Controller dependencies inside GameState

The source search identified calls such as:

```typescript
controller.reportManaTick(...)
controller.reportLucidTick(...)
controller.reportDotTick(...)
controller.reportHotTick(...)
controller.reportAutoTick(...)
```

**[Updated] The coupling was more serious than these reporting calls suggest.**

- The damage-landing path itself went through the controller: `controller.resolvePotency(p)` → `p.resolve(controller.game.getDisplayTime())`. This was proven by measurement (see section 0.2).
- **Resolved for the Viper path in session 1:** every `controller.*` call in `GameState.ts`, `Jobs/VPR.ts`, `Jobs/RoleActions.ts`, `Resources.ts` and the auto-crit code in `Potency.ts` now goes through the per-game `SimulationHost` (or the game's own config).
- **Resolved in session 2:** party-buff lookups. Potencies created in `GameState` carry their game as `partyBuffSource`, and `Buff` takes the receiving job.
- **Still global:** potencies created directly in other job files (AST, DRK, MCH, SCH, SGE, SMN), `new Buff(type)` without a job (UI code), and direct `controller.*` calls in other jobs: AST, BLU, DRK, GNB, MCH, MNK, NIN, PCT, RDM, SAM, SCH, SGE, SMN.

---

# 11. Skill Execution API

The following methods were found in:

```text
src/Game/GameState.ts
```

## 11.1 Tick

Around line 745:

```typescript
tick(
  deltaTime: number,
  prematureStopCondition = () => false,
)
```

The function:

1. Sorts the event queue.
2. Advances to the next relevant event or requested time limit.
3. Increments `this.time`.
4. Updates cooldowns.
5. Advances scheduled event timers.
6. Executes due events.
7. Removes executed events.
8. Returns the amount of time actually advanced.

Key code:

```typescript
this.time += timeToTick;
this.cooldowns.tick(timeToTick);
```

Due events execute:

```typescript
if (!e.canceled) {
  e.effectFn();
}
```

The queue is therefore central to proper damage and resource simulation.

## 11.2 Skill availability

Around line 2047:

```typescript
getSkillAvailabilityStatus(
  skillName: ActionKey,
  primaryRecastOnly: boolean = false,
): SkillButtonViewInfo
```

This method considers:

- Cooldown availability.
- Secondary cooldowns.
- MP requirements.
- Job-specific validation.
- Skill unlock levels.
- Cast time.
- Instant-cast conditions.
- Animation/availability restrictions.
- Other special-case mechanics.

Important returned information includes:

```typescript
status.timeTillAvailable
status.status.ready()
status.status.unavailableReasons
status.cdRecastTime
status.castTime
status.instantCast
```

Do not assume that waiting until the cooldown expires makes an action valid. Resource and combo requirements may still fail.

## 11.3 Execute skill

Around line 2202:

```typescript
useSkill(
  skillName: ActionKey,
  node: ActionNode,
  actionIndex: number
)
```

Execution begins with:

```typescript
const skill = this.skillsList.get(skillName);
skill.onExecute(this, node);
```

Execution then branches according to skill type:

```typescript
if (
  skill.kind === "spell" ||
  skill.kind === "weaponskill"
) {
  this.useSpellOrWeaponskill(
    skill,
    node,
    actionIndex
  );
} else if (skill.kind === "ability") {
  this.useAbility(skill, node);
} else if (skill.kind === "limitbreak") {
  this.useLimitBreak(
    skill,
    node,
    actionIndex
  );
}
```

The ActionNode is important for associated timestamps, targets, potency, and other recorded events.

Do not bypass its intended lifecycle without understanding the resulting side effects.

---

# 12. Existing ActionNode Support

File:

```text
src/Controller/Record.ts
```

The implementation provides:

```typescript
export function skillNode(
  skillName: ActionKey,
  targetList?: number[]
): ActionNode {
  return new ActionNode({
    type: ActionType.Skill,
    skillName,
    targetList: targetList ?? [1],
    healTargetCount: undefined,
  });
}
```

Other supported record/action types include:

```typescript
export const enum ActionType {
  Skill = "Skill",
  Wait = "Wait",
  JumpToTimestamp = "JumpToTimestamp",
  WaitForMP = "WaitForMP",
  SetResourceEnabled = "SetResourceEnabled",
  Unknown = "Unknown",
  Invalid = "Invalid",
}
```

This existing action model may be reusable for the new editor.

However, `Record.ts` itself imports the global controller:

```typescript
import { controller } from "./Controller";
```

It also imports localization-related UI code.

Therefore, ActionNode and Record must not yet be assumed headless or free of circular dependencies.

A longer-term refactor may move core action/record representations into a UI-independent module.

---

# 13. Existing Controller Skill Execution

File:

```text
src/Controller/Controller.ts
```

Around line 1307:

```typescript
#useSkill(
  skillName: ActionKey,
  targetList: number[],
  overrideTickMode: TickMode = this.tickMode,
  maxReplayTime: number = -1,
  addInvalidNodes: boolean = true,
  canUndo: boolean = false,
): SkillButtonViewInfo
```

The observed flow is:

### Step 1: Check availability

```typescript
let status =
  this.game.getSkillAvailabilityStatus(skillName);
```

### Step 2: Wait until available

```typescript
const beforeWaitTime = status.timeTillAvailable;

const waitNode = this.#requestTick({
  deltaTime: beforeWaitTime,
});
```

### Step 3: Handle conditional skill replacement

```typescript
skillName = getConditionalReplacement(
  skillName,
  this.game
);
```

### Step 4: Recheck availability

```typescript
status =
  this.game.getSkillAvailabilityStatus(skillName);
```

### Step 5: Create ActionNode

```typescript
const node = skillNode(skillName, targetList);
```

### Step 6: Execute valid action

```typescript
if (status.status.ready()) {
  node.tmp_startLockTime = this.game.time;

  this.record.addActionNode(node);

  actionIndex = this.record.tailIndex;

  this.game.useSkill(
    skillName,
    node,
    actionIndex
  );
}
```

### Step 7: Handle invalid action

The existing controller may still create invalid nodes and simulate their animation/cast locks using:

```typescript
this.game.useInvalidSkill(skillName, node);
```

This is important for editing existing rotations and preserving downstream timing.

### Step 8: Update timeline metadata

The controller derives:

- Lock duration.
- Recast duration.
- GCD status.
- Cast status.
- Snapshot-related timing.
- Display time.
- Skill information.
- Damage-related metadata.

### Step 9: Fast-forward in manual mode

For manual execution, the controller calls:

```typescript
this.#fastForward(maxReplayTime);
```

The initial custom adapter does not yet fully reproduce this behavior.

It generally waits before the next action rather than advancing past the current action immediately.

This must be validated against the original implementation.

---

# 14. Existing Replay System

File:

```text
src/Controller/Controller.ts
```

Around line 1435:

```typescript
#replay(props: {
  line: Line;
  replayMode: ReplayMode;
  removeTrailingIdleTime?: boolean;
  maxReplayTime?: number;
  cutoffIndex?: number;
  firstEditedNodeIndex?: number;
  selectionStart?: ActionNode;
  selectionEnd?: ActionNode;
}): ReplayResult
```

The associated result type includes:

```typescript
type ReplayResult = {
  success: boolean;
  firstAddedIndex: number | undefined;

  invalidActions: {
    node: ActionNode;
    index: number;
    reason: SkillReadyStatus;
  }[];

  skillUseTimes: number[];
};
```

The engine supports two modes:

```typescript
ReplayMode.Exact
ReplayMode.Edited
```

The `firstEditedNodeIndex` parameter allows the replay logic to distinguish unchanged earlier actions from the edited portion of a rotation.

This may be valuable for long-rotation editing.

However, `#replay` is a private controller method and is not directly callable from a new UI or external adapter.

The existing replay implementation also contains compatibility handling for historical timeline serialization.

It may modify wait nodes to account for differences between old recorded delays and current simulation timing.

A new adapter does not necessarily need all this compatibility logic, but it should not silently produce different results for current rotations.

---

# 15. Damage Statistics Coupling

File:

```text
src/Controller/DamageStatistics.ts
```

Critical import:

```typescript
import { controller as ctl } from "./Controller";
```

Around line 343:

```typescript
export function calculateDamageStats(props: {
  tinctureBuffPercentage: number;
  lastDamageApplicationTime: number;
}): DamageStatisticsData
```

The implementation uses global controller state.

Examples:

```typescript
ctl.displayingUpToDateGameState
ctl.record.getFirstSelection()
ctl.game.skillsList.get(skillName)
ctl.getTincturePotencyMultiplier()
ctl.timeline
```

The calculation also uses ActionNode potency information.

Example:

```typescript
const p = node.getPotency({
  tincturePotencyMultiplier:
    ctl.getTincturePotencyMultiplier(),

  untargetable: bossIsUntargetable,

  includePartyBuffs: true,
  includeSplash: true,

  excludeDoT:
    isDoTNode(node) &&
    !getSkillOrDotInclude("DoT"),
});
```

The global dependency is a major obstacle for multiple independent simulation results.

Merely creating two Controller objects will not resolve every global reference.

## 15.1 Proposed long-term refactor

Introduce an explicit damage-calculation context.

Conceptual interface:

```typescript
interface DamageContext {
  game: GameState;
  record: Record;
  timeline: Timeline;

  tinctureBuffPercentage: number;
  lastDamageApplicationTime: number;
}
```

Eventually damage calculation should accept the simulation context directly.

For example:

```typescript
calculateDamageStats(context)
```

rather than referring to the imported global controller.

Before applying this refactor, search the entire damage statistics module for every `ctl` reference and trace helper functions as well.

Consider separating the core damage aggregation from UI-specific data-table generation.

**[Updated] Decision in session 1:** do not refactor `DamageStatistics.ts`. It has about 50 `ctl.*` references and is a view-model for the upstream UI. `RotationSimulator.result()` aggregates directly from `ActionNode.getPotency()`, following the same conventions (auto-attacks included, GCD counted when it hits). Parity with upstream totals is enforced by the opener regression test.

---

# 16. Completed Automated Tests

A new test file was created:

```text
src/__test__/rotationLabIsolation.test.ts
```

The project uses Vitest.

The actual observed version was:

```text
vitest v5.0.5
```

## 16.1 Initial test file

The original tests were:

1. Creates independent GameState instances.
2. Keeps simulation time separate.

The test constructs a Viper configuration:

```typescript
const config = new GameConfig({
  ...DEFAULT_CONFIG,
  job: "VPR",
});

return getGameState(config);
```

**[Updated]** `DEFAULT_CONFIG` is Black Mage's config, so these tests run Viper with BLM stats. That is harmless for these assertions, but new code should use `makeDefaultConfig("VPR")`.

The first test verifies that instances and major state containers are different objects:

```typescript
expect(a).not.toBe(b);

expect(a.resources).not.toBe(b.resources);
expect(a.cooldowns).not.toBe(b.cooldowns);
expect(a.debuffs).not.toBe(b.debuffs);
```

The second test directly modifies one instance's time and verifies that the other remains unchanged.

## 16.2 Initial test execution issue

The first run showed:

```text
No test suite found in file
```

The cause was simple: the user had not saved the test file in VS Code.

No code or configuration change was required.

After saving, both tests passed.

Observed result:

```text
✓ rotationLabIsolation.test.ts (2 tests)

Test Files 1 passed (1)
Tests      2 passed (2)
```

## 16.3 Third test: Steel Fangs execution

A third test was added.

Purpose:

- Create two independent Viper states.
- Check that Steel Fangs is available in both.
- Execute Steel Fangs only in state A.
- Verify that state A consumes its GCD availability.
- Verify state B retains its original GCD availability.
- Verify B remains at simulation time zero.
- Verify Steel Fangs remains available in B.

Key operation:

```typescript
const node = skillNode("STEEL_FANGS");

node.tmp_startLockTime = a.time;

a.useSkill("STEEL_FANGS", node, 0);
```

Observed result:

```text
✓ rotationLabIsolation.test.ts (3 tests)

Test Files 1 passed (1)
Tests      3 passed (3)
```

## 16.4 Fourth test: Event queue time advancement

A fourth test was added.

Purpose:

- Create two Viper states.
- Execute Steel Fangs in state A.
- Advance state A using the real event-processing API.
- Verify state B remains unchanged.

Key operations:

```typescript
a.useSkill("STEEL_FANGS", node, 0);

a.tick(1);

expect(a.time).toBeCloseTo(1, 5);
expect(b.time).toBe(0);
```

The final observed result:

```text
RUN v5.0.5 C:/Dev/rotation_planner

✓ src/__test__/rotationLabIsolation.test.ts (4 tests) 5ms

  ✓ creates independent GameState instances
  ✓ keeps simulation time separate
  ✓ executes Steel Fangs without changing the other state
  ✓ advances time independently using the event system

Test Files 1 passed (1)
Tests      4 passed (4)

Duration 1.09s
```

**Verified test status: 4/4 passing.**

## 16.5 What these tests prove

They establish that:

- Separate Viper GameState instances can be created.
- Core resource and cooldown containers are separate.
- Immediate Steel Fangs execution affects the expected instance.
- Simple simulation time advancement works independently.
- The tested execution path does not visibly corrupt the other instance.

## 16.6 What remains unproven

These tests do NOT establish:

- Full damage event isolation.
- Isolation of all global controller callbacks.
- Correct handling of all Viper resources and buffs.
- Correct simulation of complex combos.
- Correct calculation of expected damage.
- Full equality with the original controller's replay behavior.
- Correct behavior with two long rotations.
- Correct asynchronous or interleaved execution.
- Full deterministic reproducibility for every combat mechanism.
- Correct historical patch/ruleset behavior.
- Support for future Evolved mechanics.

Do not overstate the current test coverage.

**[Updated]** The fourth test ticks for 1s after Steel Fangs. At that time, the resulting damage was resolved through the global controller without being detected. This was fixed by the `SimulationHost` seam and is covered by `rotationLabHostIsolation.test.ts`. The original four tests were committed (`3c93329f`, `76041ecd`) and still pass unchanged.

---

# 17. Headless Simulation: RotationSimulator **[Updated]**

The original handoff proposed a function-style `src/RotationLab/simulation/SimulationAdapter.ts`. It was never created. Session 1 implemented a different design instead, because the proposal had these problems:

- It created a GameState without its own host, so damage resolved through the global controller (section 0.2).
- It used `DEFAULT_CONFIG`, which is Black Mage's config.
- It omitted the controller's target filtering, the post-action fast-forward through animation lock, and `useInvalidSkill` handling.
- It aborted on the first invalid action and stopped before pending damage landed.
- A stateless function could not test interleaved simulations.

## 17.1 Files

```text
src/Game/SimulationHost.ts                     Interface the engine reports to
src/RotationLab/simulation/types.ts            Input / options / result types
src/RotationLab/simulation/RecordingHost.ts    Per-simulation host
src/RotationLab/simulation/RotationSimulator.ts
```

## 17.2 Behavior

- `new RotationSimulator(job, options)` builds `new GameConfig({...makeDefaultConfig(job), ...options.config, job})`, a `RecordingHost`, and `getGameState(config, host)`, then applies `initialResourceOverrides`, as the controller does after a restart.
- `step(...)` accepts an `ActionKey` (shorthand for a skill), `{ type: "skill", action, targets? }`, `{ type: "wait", seconds }`, or `{ type: "jumpTo", displayTime }`.
- Skill steps mirror `Controller.#useSkill` in manual tick mode:
  1. Tick for `timeTillAvailable`.
  2. Apply `getConditionalReplacement` and re-check availability.
  3. Filter targets, using the same rules as `Controller.filterTargetList`.
  4. Call `useSkill` or, if invalid, `useInvalidSkill`.
  5. Fast-forward through `timeTillAnySkillAvailable()`.
- Invalid policy (same as upstream replay): the action is kept and flagged with its reasons, its locks are rolled, and simulation continues. `result.valid` becomes false. A `jumpTo` to a past time is reported in `result.errors`.
- `finish(end)` stops at one of three points:
  - `"lastAction"` (default): matches what the upstream controller reports after a timeline load.
  - `"settled"`: ticks until every action's damage has landed, capped at 60s.
  - A number: a common fight cutoff in display time.
- `result(id)` returns:
  - Per action: requested and executed skill, start time, lock end, GCD flag, validity, applied and pending potency, and displayed modifiers.
  - Damage events.
  - Warnings and errors.
  - Totals: applied, pending and without-pot potency, auto-attack potency, and GCD count. Totals follow upstream conventions and include auto-attacks.
  - `assumptions: { partyBuffs: false, downtime: false }`.
- `simulateRotation(input, options, job = "VPR")` wraps the above.
- Units: all times are engine display time in seconds (negative during the countdown).

## 17.3 Current limitations

- Potency only. Expected damage with main stat, WD and determination is the next milestone.
- No party buffs or downtime per simulation. `RecordingHost` answers "no downtime" and returns no buff markers.
- Only VPR has been validated. Other jobs run through the same code but still contain direct global-controller calls (section 10.5).
- No result caching yet.

# 18. Rotation Lab Tests **[Updated]**

The proposed `rotationLabAdapter.test.ts` was not created. These test files exist and pass:

- `src/__test__/rotationLabIsolation.test.ts`: the original four tests, unchanged.
- `src/__test__/rotationLabHostIsolation.test.ts`: a headless state with its own host resolves damage on its own clock and leaves the global controller untouched. It failed before the engine seam.
- `src/__test__/rotationLabSimulator.test.ts` covers:
  - Basics: single action, GCD spacing with combo replacement, invalid action policy, past-time jump, fight cutoff.
  - Isolation: repeatability, A→B→A, two simulators stepped alternately equal sequential runs, global controller untouched.
  - **Parity with the real controller**: four Viper sequences (filler combo, Reawaken with ranged filler and coil, Uncoiled Fury weaves, full Reawaken into Ouroboros). Executed skill, start time, and applied and pending potency are compared per action.
  - **Opener regression**: replays `src/__test__/Asset/vpr_100_opener.txt` and reproduces the upstream expected numbers: end time 42.01667, 18 GCDs, 18316 potency without pot, 19494.32 with 8% pot, 187 pending.

## 18.1 Commands

```powershell
npm.cmd exec -- vitest run                 # full suite
npm.cmd exec -- vitest run src/__test__/rotationLabSimulator.test.ts
npm.cmd run typecheck
npm.cmd exec -- eslint src/RotationLab
```

---

# 19. Important Technical Risks

## 19.1 Global singleton dependencies

The highest-priority architectural concern is the global controller.

Both `GameState` and damage statistics contain controller dependencies.

Creating separate GameState instances is necessary but not sufficient for full isolation.

Recommended direction:

Introduce explicit per-simulation context and replace global reporting callbacks with injected interfaces.

For example, conceptually:

```typescript
interface SimulationEvents {
  onManaTick(...args: unknown[]): void;
  onDotTick(...args: unknown[]): void;
  onAutoAttack(...args: unknown[]): void;
}
```

This example is illustrative.

Use proper typed event definitions based on the existing code.

**[Updated] Status:** implemented as `SimulationHost` (`src/Game/SimulationHost.ts`) for the Viper path. Remaining global reads are listed in section 10.5.

## 19.2 Record and ActionNode coupling

The Record implementation imports the Controller singleton and localization/UI code.

This may complicate headless simulation.

Possible solution:

Extract core ActionNode and Record models into a neutral simulation module, while preserving serialization compatibility.

Do not make such a refactor until its actual necessity and affected consumers have been mapped.

## 19.3 Deterministic expected damage

The engine uses seeded RNG for some simulation events.

That does not automatically mean the resulting damage model is an analytical expected-value model.

Distinguish:

- Deterministic seeded game simulation.
- Expected-value damage calculation.
- Randomized proc simulation.
- Full Monte Carlo simulation.

The initial project requires expected damage, not a large Monte Carlo process.

## 19.4 Final damage application

Stopping the simulation immediately after the last action may omit delayed damage events.

The future adapter should allow simulation up to a defined fight cutoff, including events already scheduled.

A consistent common cutoff is required for fair rotation comparison.

**[Updated] Status:** `RotationSimulator.finish()` supports a numeric display-time cutoff and a `"settled"` mode. For comparisons, use a common numeric cutoff. `"settled"` can include extra auto-attacks that land while waiting, which would bias the longer-settling rotation.

## 19.5 Skill replacement

The original controller calls:

```typescript
getConditionalReplacement(...)
```

after automatically waiting and before executing the skill.

This ordering must be preserved where relevant.

Additional normalized or automatically replaced skill behavior should be examined in `Game/Skills.ts`.

## 19.6 Invalid actions

A comparison should not silently treat invalid rotations as valid.

The original simulator can preserve invalid actions with timing effects during replay.

**[Updated]** `RotationSimulator` follows the upstream replay policy. Invalid actions are kept and flagged with their reasons, and their locks are still rolled. The simulation continues and the result is marked `valid: false`.

Define a consistent policy for:

- Editing-time errors.
- Simulation validity.
- Illegal actions.
- Invalid resource states.
- Cooldown conflicts.
- Impossible combos.

## 19.7 Reborn/Evolved isolation

The long-term model must not accidentally share job resources or action definitions across modes.

Combat-mode rules should be explicit and testable.

Patch differences should not be implemented through uncontrolled mutations of shared global registries.

## 19.8 Comparison performance

Simulations should be cached per rotation and simulation configuration.

Modifying rotation B should not normally require re-simulating rotation A.

Any caching strategy must incorporate all gameplay-relevant inputs into its cache key.

---

# 20. Proposed Long-Term Project Organization

**[Updated]** Only `RotationLab/simulation/` exists so far: `types.ts`, `RecordingHost.ts` and `RotationSimulator.ts`. The proposed `SimulationAdapter.ts` was replaced by `RotationSimulator.ts`, and the proposed `rotationLabAdapter.test.ts` by `rotationLabSimulator.test.ts`. The rest of the structure below is still a proposal:

```text
src/
|
+-- Game/                    Existing engine
|
+-- Controller/              Existing controller
|
+-- Components/              Existing UI
|
+-- RotationLab/
|   |
|   +-- components/
|   |   +-- VerticalEditor.tsx
|   |   +-- SkillPalette.tsx
|   |   +-- RotationRow.tsx
|   |   +-- RotationTabs.tsx
|   |   +-- ComparisonChart.tsx
|   |   +-- ComparisonTable.tsx
|   |
|   +-- simulation/
|   |   +-- RotationSimulator.ts   (exists)
|   |   +-- RecordingHost.ts       (exists)
|   |   +-- types.ts               (exists)
|   |   +-- SimulationManager.ts
|   |   +-- ComparisonEngine.ts
|   |
|   +-- models/
|   |   +-- Rotation.ts
|   |   +-- Scenario.ts
|   |   +-- ComparisonResult.ts
|   |
|   +-- storage/
|       +-- LocalStorage.ts
|
+-- __test__/
    +-- rotationLabIsolation.test.ts
    +-- rotationLabAdapter.test.ts
```

The existing engine should not be modified more than necessary while the new simulation interface is under development.

Eventually, more extensive modularization may be justified, especially to support Evolved mechanics.

---

# 21. Proposed Rotation and Simulation Models

The following interfaces are conceptual and subject to refinement.

## Rotation

```typescript
interface RotationEntry {
  id: string;
  actionId: string;
  delayMs?: number;
}

interface Rotation {
  id: string;
  name: string;

  schemaVersion: number;
  patch: string;

  job: "VPR";
  mode: "reborn" | "evolved";

  actions: RotationEntry[];
}
```

## Character configuration

```typescript
interface CharacterStats {
  level: number;

  weaponDamage: number;
  mainStat: number;

  determination: number;
  directHit: number;
  criticalHit: number;
  skillSpeed: number;
}
```

## Simulation result

```typescript
interface ActionResult {
  entryId: string;

  executedAtMs: number;
  snapshotAtMs: number;

  potency: number;
  expectedDamage: number;

  warnings: string[];
}

interface SimulationResult {
  rotationId: string;

  durationMs: number;

  totalPotency: number;
  totalExpectedDamage: number;

  actions: ActionResult[];

  errors: string[];
}
```

The existing engine uses seconds in many APIs.

The proposed application model may use milliseconds for persistence and precise timestamps.

Choose a consistent unit convention and explicitly convert at API boundaries.

Do not silently mix units.

## Simulation context

```typescript
interface SimulationContext {
  rotationId: string;

  game: GameState;
  record: Record;
  timeline: Timeline;

  // Additional simulation state...
}
```

This should eventually be independent of a global controller.

---

# 22. Suggested Development Roadmap

**[Updated] Status after session 1:**

| Phase | Status |
|---|---|
| 1. Confirm repository state | Done |
| 2. Establish simulation adapter | Done, as `RotationSimulator` (section 17) |
| 3. Realistic Viper sequences | Done for the tested sequences and the level 100 opener |
| 4. Extract potency and damage events | Done for potency; damage events exposed in results |
| 5. Validate against XIV in the Shell | Done per action for four sequences plus opener totals; extend as new mechanics are used |
| 6. Multi-rotation simulation | Independent simulators done; caching not started |
| 7. Expected damage | Done for VPR in session 2 (section 0.3b); workbook cross-check pending |
| Party buffs / downtime per simulation | Done in session 2 (section 0.3c) |
| 8–10 | Not started; persistence model and cache come first (section 25) |
| 11. Codebase reduction | Planned; see below |

## Phase 1: Confirm the current repository state

Actions:

1. Inspect Git status and current branch.
2. Confirm fork and upstream remotes.
3. Inspect `package.json`.
4. Confirm existing local test files.
5. Run all relevant existing tests.
6. Verify TypeScript type checking.
7. Confirm current simulator launches.
8. Identify any changes already made since the handoff.

Do not assume the last proposed adapter files are already committed.

## Phase 2: Establish SimulationAdapter

Start from the proposed implementation.

Inspect and correct it based on the actual APIs.

Validate:

- Skill execution.
- ActionNode lifecycle.
- Automatic waiting.
- Conditional replacement.
- Cooldowns.
- Animation locks.
- Error handling.
- Repeatability.
- Multi-instance behavior.

Add regression tests.

## Phase 3: Simulate short, realistic Viper sequences

Move beyond repeated Steel Fangs calls.

Use an actual valid Viper combo sequence.

Include:

- Multiple GCDs.
- oGCD weaving.
- Combo-specific effects.
- Job resource generation/consumption.
- Buff activation.
- Event processing.

The exact valid sequence should be derived from the current VPR data and verified with the original simulator.

## Phase 4: Extract potency and damage events

Determine:

- Where potency is initially created.
- How damage snapshots are represented.
- How application times are stored.
- How auto-attacks are recorded.
- How modifiers are captured.
- How ActionNode associates damage events with skills.
- What is already expected-value based.
- What still requires additional damage formulas.

Build a headless result aggregation API.

## Phase 5: Validate against XIV in the Shell

Create equivalent rotations in:

1. The unmodified upstream-style UI/controller.
2. The new SimulationAdapter.

Compare:

- Action timing.
- Resource state.
- Cooldown state.
- Combo state.
- Potency.
- Damage events.
- Buff modifiers.
- Damage application times.

Investigate any discrepancies.

Avoid validating only final total damage, since different errors may cancel each other out.

## Phase 6: Multi-rotation simulation manager

Implement:

```typescript
simulateRotation(rotationA, config)
simulateRotation(rotationB, config)
```

Each must use independent simulation state.

Ensure results are unaffected by execution order.

Build a cache keyed by rotation, combat ruleset, and configuration.

## Phase 7: Expected damage

Implement deterministic expected actual damage.

Validate against known formulas and the existing spreadsheet.

Clearly distinguish potency from damage.

## Phase 8: Vertical editor

Implement the Rubixbob-inspired UI.

The editor should prioritize efficient keyboard/mouse usage and long rotations.

Initial scope:

- Action palette.
- Vertical rotation list.
- Insert/remove/reorder.
- Automatic timing.
- Action validation.
- Damage summary.
- Local persistence.

## Phase 9: Rotation comparison

Start with two independent rotation slots.

Support:

- Clone rotation.
- Edit independently.
- Run independently.
- Compare on common fight settings.
- Cumulative expected-damage graph.
- Expected DPS.
- Differences over time.

## Phase 10: Combat mode support

Separate Viper Reborn rules from general mechanics.

Prepare the interface for Viper Evolved.

Implement Evolved once actual mechanics and data are known.

Retain Reborn support.

## Phase 11: Codebase reduction (VPR and DRG only)

The user only needs Viper and, later, Dragoon. The other 20 upstream jobs can eventually be removed. Removal is not urgent, and doing it too early would weaken safety:

- **Other jobs' tests protect shared engine code.** `GameState.ts`, `Skills.ts`, `Potency.ts`, `Resources.ts`, `Buffs.ts` and `RoleActions.ts` are covered mostly by the other jobs' rotation tests and by `corpus.test.ts`. Their staying green through the session 1 engine changes is the main evidence that those changes preserved behavior. Keep them while shared engine code is still being changed.
- **Jobs are wired into many registries:**
  - `Game/Data/Jobs.ts` and `Game/Data/Jobs/*`
  - `Game/Jobs/index.ts` and `Game/Jobs/*`
  - `Components/Jobs/*`
  - Status display, localization, hotbar and keybind defaults
  - Presets, the job selector, and test assets
  Removing a job touches all of these.
- **Party buffs reference other jobs.** All party buff definitions live in `Game/Buffs.ts`. Each one is tagged with its source job's `ShellJob` ID (`"RPR"`, `"DNC"`, `"AST"`, …), and the AST card logic reads `JOBS[...]` roles. Party buffs matter for VPR/DRG comparisons, so those job IDs and their role entries must remain valid even if the jobs' action and state files are removed.
- Removal makes selective upstream merges much harder.

Recommended order:

1. **Now (cheap, reversible):** nothing, or at most hide other jobs from the job selector UI.
2. **When the Rotation Lab UI replaces the upstream UI and the engine refactors have settled:**
   - Remove other jobs in one dedicated, reviewable commit.
   - Keep shared role/limit-break/party-buff data.
   - Before deleting the other jobs' tests, add VPR/DRG rotation tests that cover the same shared engine paths: casts, DoTs, auto-attacks, charges and party buffs.
3. Remove the upstream timeline UI only after nothing in Rotation Lab depends on it. `Record.ts`, `Controller.ts` and `DamageStatistics.ts` are currently imported by the engine.

Dragoon already has no direct `controller.*` calls in `Game/Jobs/DRG.ts`. It should work with `RotationSimulator` once validated with parity tests like Viper's.

---

# 23. Current Git and Development Workflow

The user prefers GitHub Desktop over command-line Git for routine repository management.

Recommended branch:

```text
feature/rotation-lab
```

Previously recommended commit messages:

```text
test: add initial Viper GameState isolation tests
```

and:

```text
test: verify Viper GameState and event isolation
```

**[Updated]** Both were committed as `3c93329f test: add initial Viper GameState isolation tests` and `76041ecd test: verify independent Viper GameState execution`. The user makes commits through GitHub Desktop. Claude Code advises which files belong in which commit.

For routine changes, the user can commit and push through GitHub Desktop.

Claude Code may use Git directly when appropriate.

Avoid force pushes and destructive history changes without explicit authorization.

---

# 24. Source and Test Artifacts From Previous Analysis

The following local analysis files were generated by PowerShell commands and uploaded to the prior conversation:

```text
architecture-search.txt
simulation-analysis.txt
skill-api-search.txt
skill-execution-analysis.txt
rotation-adapter-analysis.txt
```

Additionally, there were pasted text outputs containing earlier search results.

The key findings from these files have been summarized above.

These analysis files are not necessarily present in the local Git repository, except where the user generated them there.

The exact uploaded copies may be available separately through the previous ChatGPT conversation.

Claude Code should prioritize inspecting the actual source files.

Relevant locations include:

```text
src/Controller/Controller.ts
  202-243    Constructor
  615-643    Damage-statistics updating
  1131-1162  Tick handling
  1307-1430  Skill execution
  1435+      Replay
  2297+      Public requestUseSkill
  2639       Singleton export

src/Game/GameState.ts
  123+       Constructor
  745-804    Tick/event processing
  2047+      Skill availability
  2202-2224  Skill execution

src/Game/Jobs/index.ts
  26+        GameState factory
  59-60      Viper state construction

src/Controller/Record.ts
  1-135      Action representation
  107-114    skillNode factory

src/Controller/DamageStatistics.ts
  1          Global controller import
  343+       calculateDamageStats
```

Line numbers reflect the repository revision inspected during the conversation and may change.

**[Updated]** These line numbers are now stale. `GameState.ts` gained about 12 lines near the top in session 1, and the `controller.*` calls listed above were renamed to `this.host.*`. Search by symbol name instead.

---

# 25. Immediate Next Actions for Claude Code **[Updated]**

The latest verified development result is:

**Isolated headless Viper simulation with expected damage (section 0.3b); full suite 163 passed + 9 expected-fail.**

Party buffs and downtime are done (section 0.3c). Next milestone: **rotation persistence model and result cache.**

1. Run the full suite and typecheck to confirm the baseline.
2. Define a versioned, serializable rotation document: schema version, patch/ruleset, job, mode, steps, and the shared scenario (stats, weapon delay, tincture grade, party buffs, downtime, cutoff).
3. Add a pure function from document to `simulateRotation` input and options. Cache results keyed by the full serialized inputs.
4. Local persistence: browser storage with export/import as JSON files.
5. Then start the vertical editor and two-slot comparison UI on top of this.

Focus first on correctness. Do not start a large new UI or implement speculative Evercold mechanics before these are validated.

---

# 26. Acceptance Criteria for the First Useful MVP

The first usable release should include:

- Local browser execution.
- Viper support.
- Fast vertical rotation editor.
- Correct action timing.
- GCD and oGCD handling.
- Existing Viper cooldown and resource mechanics.
- Expected damage calculations.
- Two independent editable rotations.
- Shared simulation configuration.
- Cumulative expected-damage comparison.
- Expected DPS comparison.
- Clear handling of invalid rotations.
- Local saving/loading.
- Automated tests.
- A structure capable of supporting Reborn and Evolved separately.

A full Monte Carlo engine, cloud sync, account management, and support for every FFXIV job are outside the initial scope.

---

# 27. Important Uncertainties and Verification Requirements

**[Updated] Resolved in session 1:**

- Branch is `feature/rotation-lab`.
- The isolation tests are committed.
- The proposed SimulationAdapter was **not** created. It was superseded by `RotationSimulator` (section 17).
- The original engine does **not** calculate expected actual damage. Its totals are potency only (section 6).
- Damage statistics **cannot** run independently from the UI, and Rotation Lab does not use them (section 15).

Still do not treat the following as established facts:

- GameState is fully free of global shared state. It is not: party buffs, `Buffs.ts`, and non-VPR jobs still use the controller (section 10.5).
- Simulation parity holds for Viper mechanics beyond those covered by the parity and opener tests.
- Reborn and Evolved have finalized mechanic specifications.
- Future game patch data is already available or correct.
- The existing spreadsheet remains authoritative for current balance data.
- The current UI is already suitable for multi-rotation comparison.

Verify these points as they become relevant.

A particularly important distinction:

**Potency parity with XIV in the Shell is established for the tested Viper sequences. Expected damage, party buffs and downtime are not yet modeled.**

The next meaningful technical milestone is deterministic expected damage on top of `RotationSimulator` (section 25).

---

# 28. Final Project Direction

The project is an independently maintained fork of XIV in the Shell, focused on Viper rotational theorycrafting.

Its defining characteristics are:

1. **Vertical, highly editable rotation construction**, inspired by Rubixbob's Dragoon planner.
2. **Accurate deterministic expected-damage simulation**, using the existing XIV in the Shell engine wherever possible.
3. **Multi-rotation comparison as a first-class feature**, rather than an afterthought.
4. **Strong separation of simulation state and user interface**, enabling multiple simultaneous or sequential rotation evaluations.
5. **Extensible Reborn/Evolved combat-mode support**, to accommodate fundamental job changes in Evercold.
6. **High performance and responsive editing**, addressing the central shortcomings of the current Google Sheets workflow.

The user's strengths are FFXIV gameplay knowledge, damage formulas, job mechanics, and the ability to validate rotational outcomes.

Claude Code should primarily handle software architecture, implementation, testing, refactoring, UI development, and tooling.

**Start by reading section 0, verifying the test baseline, and then implementing the next milestone: expected damage (section 25).**