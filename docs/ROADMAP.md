# Project roadmap

The overall plan, agreed with the user on 2026-11-13 after a review of the whole project. It sets
the order of work across the project; the comparison milestones keep their own file
(`comparison/COMPARISON_ROADMAP.md`). Work one step at a time, only the one the user names, and
update the status column when a step is done. Effort: L / M / H.

Why this order: the damage totals had no current, independent check, the repo's CI checks were
failing, and nothing in the earlier plans covered the Evercold release (expected around February
2027, unverified). Dawntrail-only tuning has a short shelf life, so it is kept light.

## Standing decisions (2026-11-13)

-   **Upstream is pull-only.** Never push to XIV in the Shell and never open pull requests there.
    Upstream changes come in by merging (see "Syncing with upstream" below).
-   **The recommender advises, it does not build rotations.** It suggests good next actions while
    the user builds a rotation by hand. Do not judge it by, or tune it for, full fights played on
    autopilot.
-   **The comparison roadmap is paused after M4** until Phase 1 is done. M5 is small and may be
    slotted in when the user asks. M6, M6b, full M7 and M8 wait.
-   **Keep engine edits small.** Every changed line in `src/Game`, `src/Controller` or
    `src/Components` can conflict with an upstream merge.

## Phase 0: make the checks honest

| #   | Step                                                                                                                                                                                                                                          | Status                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 0.1 | Repo-wide lint and format checks pass, as CI (`.github/workflows/precommit.yml`) runs them                                                                                                                                                    | done 2026-11-13                                                                          |
| 0.1 | `/verify-task` runs the same commands as CI                                                                                                                                                                                                   | done 2026-11-13 (edited by the user)                                                     |
| 0.2 | Stale docs corrected (test counts, M4 status, xivgear path)                                                                                                                                                                                   | done 2026-11-13                                                                          |
| 0.3 | Fork identity: README notice, `public/CNAME` removed, four leftover analysis `.txt` files removed                                                                                                                                             | done 2026-11-13                                                                          |
| 0.3 | Move `@playwright/test` to devDependencies (`npm install -D @playwright/test`)                                                                                                                                                                | done 2026-11-13 (by the user)                                                            |
| 0.3 | The 7.2 workbook is untracked and git-ignored (`/reference`); it stays on disk for cross-checks. It is still in the git history (commit 4bfb28f2); purging that needs a history rewrite and force-push, which only the user may decide and do | done 2026-11-13 (history purge: user's call)                                             |
| 0.4 | Upstream fetched; push to upstream disabled (`git remote set-url --push upstream DISABLED`)                                                                                                                                                   | done 2026-11-13 (push URL is `DISABLED`; never test it with a real push or pull request) |
| 0.4 | First upstream merge (3 commits behind on 2026-11-13, dry run clean)                                                                                                                                                                          | done 2026-11-13 (merge 1fe4d4db, suite green, no Viper data changed)                     |

## Phase 1: prove the numbers (M each)

| #   | Step                                                                                                                                                                                                                                                                                   | Status                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1.5 | Time-zero toggle ("first press at 0 s"), as requested on 2026-11-09 (handoff section 7). First, because cross-checks against other tools need the same clock.                                                                                                                          | done 2026-11-13 (scenario setting, schema 7)                                                                         |
| 1.6 | Cross-check against xivgear's Viper sim (`~/dev/gear-planner/gear-planner/packages/sims/src/melee/vpr`): the same action list on the same gear, per-action and total damage pinned in a permanent test with a stated tolerance. Differences must be explained, not tuned away.         | done 2026-11-13; the user confirmed the Lab's values (handoff section 8)                                             |
| 1.7 | Golden rotations: the user supplies an opener and a 2-minute loop; totals are pinned. Plus a self-play regression test (follow the top recommendation for a fight; it must stay valid with no overcap warnings). That test guards against regressions, it does not measure optimality. | self-play test done 2026-11-13; golden rotations: the user will add "Golden Opener" and "Golden Rotation" in the Lab |
| 1.8 | Label results: the game patch in the ruleset metadata and a hand-bumped `ENGINE_VERSION` (comparison spec Q3), shown in the UI and written into every export. This is the cheap slice of M7.                                                                                           | done 2026-11-13 (`ENGINE_VERSION` 1, game patch 7.5)                                                                 |

## Phase 2: recommendations and editor

| #    | Step                                                                                                                                                                                                                                                                                             | Status                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 2.9  | Animation lock as a scenario setting (engine default 0.7 s, not exposed today). It decides whether a double weave clips: at 0.7 s it fits a 2.12 s GCD by 0.02 s. Schema bump and migration.                                                                                                     | open                        |
| 2.9  | Weave room from time instead of a fixed two slots (`WEAVE_SLOTS` in `recommend/context.ts`). Today the list can suggest a second oGCD inside a 1.70 s Generation GCD, which clips by 0.40 s. This revisits the session-4 decision "assume 2 slots", so confirm with the user before changing it. | open, confirm first         |
| 2.10 | Opener presets: a few named starting rotations. They double as the golden rotations of 1.7.                                                                                                                                                                                                      | open                        |
| 2.11 | Holding gauge ahead of Serpent's Ire                                                                                                                                                                                                                                                             | dropped for Dawntrail       |
| 2.12 | Tincture lane (feature request of 2026-11-09, handoff section 7)                                                                                                                                                                                                                                 | open, small                 |
| 2.12 | "Fill to time T" with the recommender                                                                                                                                                                                                                                                            | idea, revisit after Phase 5 |

## Phase 3: let others use it (L–M each)

| #    | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.13 | Host the built site on GitHub Pages from the fork (free for public repos). Needs a `base` path in the Vite config and the Lab as the landing page. Low priority: the user does not want to publish yet (2026-11-13).                                                                                                                                                                                                                                                                  | later  |
| 3.14 | Sharing through Discord, the group's main channel. Long links disrupt the chat, so the primary path is a small file: "Share" downloads one rotation (with its gear and scenario) as a compact file to drop into Discord, and the Lab imports it by drag-and-drop or the Import button. Optional second path: a link with the data after `#`, offered only when it stays short (opener-sized), copied as a Discord masked link `[name](url)`. No backend, no shortener, no stored ids. | open   |
| 3.15 | Scenario helpers: downtime from upstream's fight timeline presets (`public/presets/markers`), "repeat every 120 s" for party buffs.                                                                                                                                                                                                                                                                                                                                                   | open   |
| 3.16 | Safety net: an error screen with "export workspace" instead of a blank page, an automatic rolling backup of the workspace, and a warning when the Lab is open in a second tab (today the last tab to save silently wins).                                                                                                                                                                                                                                                             | open   |

## Phase 4: Dragoon as the Evercold rehearsal (H)

| #    | Step                                                                                                                                                                                                                                                                     | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 4.17 | Dragoon end to end (handoff section 7, items 1 and 4): job picker instead of the hard-coded `JOB` in `ui/RotationLabApp.tsx`, damage constants, DoT stop, Battle Litany from the rotation, resource tracking, `recommend/drg.ts`. Cross-check against xivgear's DRG sim. | open   |
| 4.18 | Fix the circular imports locally (handoff section 7, item 6), so the Lab page no longer has to load the original app first. Nothing is sent upstream.                                                                                                                    | open   |

## Phase 5: Evercold

| #    | Step                                                                                                                                 | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 5.19 | Merge upstream's update, add level 110 constants from xivgear, bump the Reborn ruleset, then build Evolved from published data only. | open   |

## Parked until there is demand

Comparison M6, M6b, full M7 and M8; a variance estimate (how much crit and direct-hit luck moves a
result); marking missed positionals; codebase reduction (handoff section 7, item 7).

## Syncing with upstream

`git fetch upstream` only downloads upstream's commits. It never changes a file in the working
folder or any local branch. Files change only when upstream is merged, and git never silently
overwrites a local edit: where both sides changed the same lines it stops and marks a conflict.

Routine, about monthly and right before Evercold work starts:

1.  `git fetch upstream`, then `git log --oneline feature/rotation-lab..upstream/main` to see what is new.
2.  Dry run without touching files: `git merge-tree --write-tree --name-only feature/rotation-lab upstream/main`.
    A clean run prints one hash; conflicts are listed by file.
3.  Merge on a throwaway branch: `git switch -c sync/upstream-<date>` then `git merge upstream/main`.
4.  Resolve conflicts. The files the Lab edited are the likely ones: `src/Game/GameState.ts`,
    `Potency.ts`, `Resources.ts`, `Buffs.ts`, `XIVMath.ts`, `SimulationHost.ts`, `Jobs/VPR.ts`,
    `Jobs/RoleActions.ts`, `Jobs/index.ts`, `src/Controller/Record.ts` (handoff section 5 lists why
    each was changed). Keep both intentions: upstream's fix and the Lab's seam.
5.  Run the full suite. The parity tests must stay exact unless upstream changed game data; if it
    did, bump `AVAILABLE_RULESETS` and say so. Never edit expected values just to pass.
6.  Merge the branch into `feature/rotation-lab` only when everything is green. To abandon a bad
    merge: `git merge --abort`, or delete the throwaway branch.
