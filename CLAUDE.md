
# FFXIV Rotation Lab

## Project Overview

This project is an independently maintained fork of XIV in the Shell, focused initially on FFXIV Viper (VPR).

Read `docs/PROJECT_HANDOFF.md` for the complete project history, architectural findings, verified tests, technical decisions, and implementation roadmap.

Treat the handoff as historical project context. Inspect the actual repository before relying on any implementation or test status described there.

## Primary Goals

1. Build a fast, vertically oriented rotation editor inspired by https://www.rubixbob.com/.
2. Reuse existing XIV in the Shell combat mechanics wherever practical.
3. Support multiple independently editable and comparable rotations.
4. Calculate deterministic expected damage, not full Monte Carlo simulations.
5. Compare cumulative damage, DPS, burst windows, and different fight durations.
6. Support both Viper Reborn and future Evolved combat modes, with independently versioned rulesets.
7. Keep the application local-first, with no backend requirement.

## Environment

- Windows
- VS Code with Claude Code
- GitHub Desktop for Git management
- React, TypeScript, Vite, Vitest
- npm
- Local development server: http://localhost:3000/

Use Windows-compatible commands. When invoking npm from PowerShell, prefer `npm.cmd`.

## Architecture Rules

- Preserve working game mechanics whenever possible.
- Separate simulation state from React/UI.
- Avoid introducing additional global singleton state.
- Investigate existing global Controller dependencies carefully.
- Each rotation must have an independent simulation context.
- Implement Reborn/Evolved mechanics as separately maintainable rulesets.
- Preserve upstream MIT license notices and attribution.
- Avoid speculative game mechanics and unverified potency values.
- Do not perform broad refactors or dependency upgrades without a clear reason.
- Keep the existing XIV in the Shell functionality working unless an explicitly approved change requires otherwise.

## Working Practices

- Inspect relevant source code before modifying it.
- Prefer complete, tested implementations over pseudocode.
- Add or update Vitest tests for simulation changes.
- Run relevant tests and TypeScript checks after code changes.
- Never silently modify expected test values just to make tests pass.
- Verify whether files already exist before creating replacements.
- Distinguish actual test results from assumptions.
- Explain major changes and outstanding risks in plain English.
- Make incremental, reviewable changes.
- Do not force-push or destructively alter Git history.
- Ask for clarification when FFXIV mechanics are genuinely ambiguous.

## Job Scope

Only Viper (VPR) and, later, Dragoon (DRG) are needed. The other upstream jobs may be
removed when it is safe to do so (see "Codebase reduction" in `docs/PROJECT_HANDOFF.md`).
Until then, keep their code and tests: they are the regression net for shared engine code.

## Current Verified Baseline (2026-11-02)

- Original XIV in the Shell application runs locally; confirmed by the user after the engine changes.
- Full suite: 30 test files, 166 passed + 9 expected-fail (upstream `it.fails` cases). `tsc --noEmit` and ESLint clean.
- Expected damage: `src/RotationLab/damage/DamageModel.ts` reimplements xivgear's formulas (floored chain, main stat with party bonus, WD, auto-attacks with weapon delay, Gemdraught as capped +10% main stat). Verified constants: levels 80/90/100; jobs: VPR only (Dex jobmod 110, weapon delay 2.64, no trait). Other jobs/levels report potency only (`result.damage` undefined).
- Reference repo for formulas: local clone at `C:\Dev\gear-planner` (xivgear; the author permits reuse). Search it locally instead of fetching from GitHub.
- Headless simulation exists: `src/RotationLab/simulation/RotationSimulator.ts`.
  Each simulation owns its GameConfig, GameState and `RecordingHost`; it does not touch the global controller.
- Per-action parity with the real controller is tested on four Viper sequences, and the upstream
  level 100 opener totals are reproduced exactly.
- Party buffs and downtime are not modeled yet.

Check the actual working tree and test results before continuing.

## Engine Facts That Are Easy to Get Wrong

- `GameState.host` (interface in `src/Game/SimulationHost.ts`) receives damage resolution, warnings
  and timeline events. It defaults lazily to the global `controller`; pass a host via
  `getGameState(config, host)` for headless runs. Never reference `controller` in a GameState
  field initializer: the controller builds a GameState while its own module is still loading.
- Damage only "lands" when the host calls `Potency.resolve()`. Without a per-game host, a headless
  GameState reports into the global controller.
- `DEFAULT_CONFIG` is Black Mage's config. Use `makeDefaultConfig("VPR")` for Viper.
- `DamageStatistics.ts` is a UI view-model bound to the global controller. Aggregate from
  `ActionNode`/`Potency` (as `RotationSimulator.result()` does) instead.
- Remaining global-controller reads on the Viper path: party buffs
  (`Potency.getAmount` with `includePartyBuffs: true`, `ActionNode.getPartyBuffs`) and `Buffs.ts` (AST cards).
- `git` is not on PATH; GitHub Desktop's bundled `git.exe` works. The user makes commits through GitHub Desktop.

## Next Development Priority

1. Per-simulation party buffs and downtime (move them from the global timeline into simulation options).
2. (Done) Expected damage cross-checked against the 7.2 workbook; see `rotationLabWorkbook.test.ts`.
3. Rotation persistence model (schema version, patch, ruleset) and a result cache keyed by all simulation inputs.
4. Vertical editor and two-slot comparison UI on top of `RotationSimulator`.
5. Dragoon support through the same simulator.

Prioritize simulation correctness before large UI changes.

## Reference Material

The workbook `reference/VPR 7.2 DT Planner v2.22.xlsx`
contains historical Viper rotation logic, formulas,
skill data, and sample calculations for patch 7.2.

Use it for analysis and regression-test development.
Do not assume its skill values are valid for newer patches.