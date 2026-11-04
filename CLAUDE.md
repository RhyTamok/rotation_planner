# FFXIV Rotation Lab

## Project Overview

This project is an independently maintained fork of XIV in the Shell, focused on FFXIV Viper (VPR)
and later Dragoon (DRG).

**Read `docs/PROJECT_HANDOFF.md` first.** It describes the current state, architecture map,
engine pitfalls, the game rules the user has confirmed, open work and how to verify changes.
The detailed history of sessions 1–3 is in `docs/archive/PROJECT_HANDOFF_sessions-1-3.md`: search
it when needed, don't read it whole.

Treat both as context. Inspect the repository and run the tests before relying on any status
described there.

**Comparison system:** the agreed design, audit and plan are in `docs/comparison/`
(`COMPARISON_SPEC.md`, `COMPARISON_AUDIT.md`, `COMPARISON_ROADMAP.md`). They describe planned work;
only the audit states what exists. Do not implement from them until the user approves a milestone.

## Primary Goals

1. Build a fast, vertically oriented rotation editor inspired by https://www.rubixbob.com/.
2. Reuse existing XIV in the Shell combat mechanics wherever practical.
3. Support multiple independently editable and comparable rotations.
4. Calculate deterministic expected damage, not full Monte Carlo simulations.
5. Compare DPS, cumulative damage, burst windows, and different fight durations.
6. Support both Viper Reborn and future Evolved combat modes, with independently versioned rulesets.
7. Keep the application local-first, with no backend requirement.

## Environment

-   Windows, VS Code with Claude Code, GitHub Desktop for Git (the user commits; `git` is not on PATH).
-   React, TypeScript, Vite, Vitest, npm. Use `npm.cmd` from PowerShell.
-   Dev server: `npm.cmd run start` → http://localhost:3000/ (original app) and
    http://localhost:3000/rotation-lab.html (Rotation Lab).

## Architecture Rules

-   Preserve working game mechanics whenever possible.
-   Separate simulation state from React/UI.
-   Avoid introducing additional global singleton state.
-   Investigate existing global Controller dependencies carefully.
-   Each rotation must have an independent simulation context.
-   Implement Reborn/Evolved mechanics as separately maintainable rulesets.
-   Preserve upstream MIT license notices and attribution.
-   Avoid speculative game mechanics and unverified potency values.
-   Do not perform broad refactors or dependency upgrades without a clear reason.
-   Keep the existing XIV in the Shell functionality working unless an explicitly approved change requires otherwise.
-   All Rotation Lab workspace changes go through `setWorkspace` in `RotationLabApp`, so they are undoable.
-   When game data or mechanics change, bump `AVAILABLE_RULESETS` in `models/Rotation.ts`. When a
    stored document's shape changes, bump `SCHEMA_VERSION` and add a step in `storage/migrations.ts`.

## Working Practices

-   Inspect relevant source code before modifying it.
-   Prefer complete, tested implementations over pseudocode.
-   Add or update Vitest tests for simulation changes.
-   Run relevant tests and TypeScript checks after code changes.
-   Never silently modify expected test values just to make tests pass.
-   Verify whether files already exist before creating replacements.
-   Distinguish actual test results from assumptions.
-   Explain major changes and outstanding risks in plain English.
-   Make incremental, reviewable changes. End each task with a suggested commit message and file list.
-   Do not force-push or destructively alter Git history.
-   Ask for clarification when FFXIV mechanics are genuinely ambiguous, and record the answer in the handoff (section 6).
-   Keep token use low: targeted reads, batched checks, full test suite once per task.
-   Update `docs/PROJECT_HANDOFF.md` and this file at the end of each task.

## Tools and Skills

-   **`/verify-task` skill** (user-invoked, `.claude/skills/verify-task/`): the end-of-task routine
    (format, typecheck, lint, full tests once, page check, bump checks, commit message). Suggest it
    when a task is finished; don't duplicate its steps by hand.
-   **context7 MCP**: use it when a framework or library API is unclear, especially for
    version-specific behavior (React 19, Vite 8, Vitest 5, TypeScript). Do not use it for XIV in the
    Shell internals: inspect the local code instead. External docs are never more authoritative than
    this repository's code, tests or the confirmed rules in the handoff.
-   **Playwright MCP** (local scope, restricted to `http://localhost:3000`, isolated profile, service
    workers blocked): use sparingly, only where it clearly beats asking the user, e.g. a quick
    console-error or render check of `rotation-lab.html`. The dev server must already be running.
    Most browser-based testing and all visual/UX review stay with the user. Prefer
    `tools/dev-load/` (handoff section 8) for blank-page checks.

## Pitfalls That Break Things Silently

-   **New browser entry points must import `Components/Main` first** (see `src/RotationLab/ui/main.tsx`).
    The engine's circular imports otherwise leave the page blank. Only the dev server reproduces
    this, not Vitest or the build: verify with `tools/dev-load/` (handoff section 8). Run it from
    PowerShell with an absolute root path.
-   Format with `npm.cmd exec -- prettier-no-jsx-parens -w <paths>`, never plain `prettier`.
-   `DEFAULT_CONFIG` is Black Mage's; use `makeDefaultConfig(job)`.
-   Never reference `controller` in a GameState field initializer.
-   Lab potency/damage calls pass `bossDebuffsOnPrimaryOnly: true`; a new `getAmount`/`getPotency`
    call in `src/RotationLab` without it silently applies Dokumori/Chain Stratagem to every AoE target.

## Job Scope

Only Viper and, later, Dragoon are needed. Keep the other upstream jobs and their tests for now:
they are the regression net for shared engine code (handoff section 7, codebase reduction).

## Reference Material

-   `reference/VPR 7.2 DT Planner v2.22.xlsx`: historical 7.2 Viper workbook, used for regression
    tests. Its values may be outdated; its sheets are large, so estimate the token cost before reading.
-   `C:\Dev\gear-planner`: local clone of xivgear (formulas, API). The author permits reuse.
