---
name: verify-task
description: End-of-task verification for Rotation Lab. Runs typecheck, eslint, the full vitest suite once, formats changed files, then reports results and a suggested commit message with file list.
disable-model-invocation: true
---

# Verify task

Run from the repo root in bash (WSL). Use plain `npm`. Be token-frugal: one batched
run per step, and only quote failing output.

## Steps

1. **Changed files.** List them with `git status --short`.
2. **Format** changed `.ts`/`.tsx`/`.md` files with
   `npm exec -- prettier-no-jsx-parens -w <paths>`. Never plain `prettier`.
3. **Typecheck:** `npm run typecheck`
4. **Lint:** `npm exec -- eslint src/RotationLab`
5. **Tests:** the full suite once: `npm exec -- vitest run`.
   - Never edit expected test values just to make tests pass. If one fails, report it.
   - Upstream VPR opener totals in the parity tests must stay exact.
   - `ECONNREFUSED 127.0.0.1:3000` noise from `sanity.test.tsx` is harmless (no dev server running).
6. **Dev-server page check**, only if this task added engine imports to the page or a new browser
   entry point (see handoff section 8):
   - start `npm exec -- vite --port 3100 --strictPort` in the background
   - run `node tools/dev-load/dev-load.mjs "$PWD" http://localhost:3100 /src/RotationLab/ui/main.tsx`
   - expect `errors: none`, then stop the server. Never touch port 3000.
7. **Bump checks:**
   - Game data or mechanics changed → `AVAILABLE_RULESETS` in `models/Rotation.ts` bumped?
   - Stored document shape changed → `SCHEMA_VERSION` bumped and a step in `storage/migrations.ts`?
8. **Docs:** `docs/PROJECT_HANDOFF.md` (and CLAUDE.md if rules changed) updated for this task?

## Report

State actual results per step (pass/fail/skipped, with counts), distinguishing what was run from what
was assumed. Mention outstanding risks in plain English. Then give:

- a suggested commit message (conventional style, e.g. `feat: ...`, `fix: ...`, `docs: ...`)
- the file list to commit

You may `git commit` the verified changes with that message. Do not push; the user pushes.
