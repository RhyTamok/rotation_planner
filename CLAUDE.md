# FFXIV Rotation Lab

## Project Overview

This project is an independently maintained fork of XIV in the Shell, focused on FFXIV Viper (VPR)
and later Dragoon (DRG).

**Read `docs/PROJECT_HANDOFF.md` first.** It describes the current state, architecture map,
engine pitfalls, the game rules the user has confirmed, open work and how to verify changes.
The detailed history of sessions 1–3 is in `docs/archive/PROJECT_HANDOFF_sessions-1-3.md`: search
it when needed, don't read it whole.

**`docs/ROADMAP.md` sets the order of work** across the project (agreed 2026-11-13) and holds the
upstream merge routine. Work only on the step the user names and update its status when done.

Treat both as context. Inspect the repository and run the tests before relying on any status
described there.

**Comparison system** (M0–M4, M3a, M3b and M8a done, M5–M8 and M6b planned, plan approved 2026-11-05, all spec questions decided), `docs/comparison/`; read only when
working on comparison features, not otherwise: start with `COMPARISON_ROADMAP.md` (status table and
the milestone; its "Reconciliation" section maps `comparison-design-spec.md`, the UI/metric baseline, to the code), then `COMPARISON_SPEC.md` sections 2–3 for definitions and data model; the
`COMPARISON_AUDIT.md` lists what exists today and where. Work one milestone at a time, only the one
the user names; update the roadmap status table when it is done.

## Primary Goals

1. Build a fast, vertically oriented rotation editor inspired by https://www.rubixbob.com/.
2. Reuse existing XIV in the Shell combat mechanics wherever practical.
3. Support multiple independently editable and comparable rotations.
4. Calculate deterministic expected damage, not full Monte Carlo simulations.
5. Compare DPS, cumulative damage, burst windows, and different fight durations.
6. Support both Viper Reborn and future Evolved combat modes, with independently versioned rulesets.
7. Keep the application local-first, with no backend requirement.

## Environment

-   WSL2 Ubuntu (bash), VS Code with the WSL extension, Claude Code. The repo lives in the Linux
    filesystem (`~/dev/rotation_planner`), never under `/mnt/c`. `git` is on PATH.
-   XIV in the Shell (`upstream` remote) is pull-only: never push to it or open pull requests
    there. Merge upstream only with the user's go-ahead, following `docs/ROADMAP.md`.
-   Claude may run `git commit` (small, reviewable commits with the suggested message). The user
    pushes. Never push, force-push or rewrite history.
-   React, TypeScript, Vite, Vitest, npm. Use plain `npm` from bash.
-   Dev server: `npm run start` → http://localhost:3000/ (original app) and
    http://localhost:3000/rotation-lab.html (Rotation Lab). Open them in the Windows browser; WSL2
    forwards localhost.

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
-   Run relevant tests and TypeScript checks after code changes. Lint and format checks are
    repo-wide (`npm run lint`, `npm exec -- prettier-no-jsx-parens --check .`), as in CI.
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
    this, not Vitest or the build: verify with `tools/dev-load/` (handoff section 8). Pass an
    absolute root path (`"$PWD"`); Node rejects `.`.
-   Format with `npm exec -- prettier-no-jsx-parens -w <paths>`, never plain `prettier`.
-   `DEFAULT_CONFIG` is Black Mage's; use `makeDefaultConfig(job)`.
-   Never reference `controller` in a GameState field initializer.
-   Lab potency/damage calls pass `bossDebuffsOnPrimaryOnly: true`; a new `getAmount`/`getPotency`
    call in `src/RotationLab` without it silently applies Dokumori/Chain Stratagem to every AoE target.

## Job Scope

Only Viper and, later, Dragoon are needed. Keep the other upstream jobs and their tests for now:
they are the regression net for shared engine code (handoff section 7, codebase reduction).

## Reference Material

-   `reference/VPR 7.2 DT Planner v2.22.xlsx`: local only (git-ignored since 2026-11-13, never commit it;
    ask the user for the file if it is missing). Historical 7.2 Viper workbook, used for regression
    tests. Its values may be outdated; its sheets are large, so estimate the token cost before reading.
-   `~/dev/gear-planner/gear-planner`: local clone of xivgear (clone https://github.com/xiv-gear-planner/gear-planner into `~/dev/gear-planner` if missing): formulas, API, and its Viper and Dragoon sims in `packages/sims/src/melee/`. The author permits reuse.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

-   When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
-   If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
-   Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
-   After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
-   A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
