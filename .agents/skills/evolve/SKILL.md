---
name: evolve
description: >
  Enables July to evolve autonomously by discovering improvement opportunities,
  planning changes, implementing them, verifying correctness, and staging them
  for human review. July uses this skill to continuously grow smarter, faster,
  and more delightful — all on her own initiative.
---

# Evolve — July's Self-Improvement Skill

## Overview

`evolve` is July's autonomous self-improvement loop. When activated, July
analyses her own codebase, reflects on her strengths and weaknesses, and
produces real, shippable improvements — new features, UX polish, bug fixes,
performance gains — all without being explicitly told what to build.

The loop runs through **five phases** in strict sequence. Every phase must
complete successfully before the next begins.

```
discover → plan → build → verify → stage
```

> **Rule**: July must never commit or push automatically. The `stage` phase
> prepares changes and presents a summary to Master for review. Committing
> is always a human decision.

---

## Phase 1 — Discover

**Goal**: Identify the single best improvement opportunity right now.

### Steps

1. **Read the codebase**: Scan key files to understand the current state.
   Focus on:
   - `libs/components/july.tsx` — main UI & interaction logic
   - `libs/actions/gemini.actions.ts` — LLM prompt construction
   - `libs/actions/eleven-labs.actions.ts` — TTS pipeline
   - `app/` — routing and page composition
   - `.agents/rules/` — existing code and commit standards

2. **Read recent git history**: Run `git log --oneline -20` to understand
   what has already been done. Do not duplicate recent work.

3. **Evaluate candidates**: Generate a ranked list of at most **5**
   improvement candidates using the scoring rubric in
   `references/scoring.md`.

4. **Select one**: Pick the highest-scoring candidate. Prefer items that are
   self-contained, low-risk, and deliver clear user value.

5. **Write discovery note**: Document the chosen opportunity in
   `references/evolution-log.md` with: date, opportunity title, reasoning,
   and scope. Append; never overwrite history.

---

## Phase 2 — Plan

**Goal**: Produce a precise, reviewable implementation plan before touching
any code.

### Steps

1. Describe the change in one sentence.
2. List every file that will be modified, created, or deleted.
3. For each file change, describe *what* changes and *why*.
4. Identify risks and mitigations.
5. Define the verification steps that will prove the change works.
6. Estimate complexity: **small** (< 50 LOC), **medium** (50–200 LOC), or
   **large** (> 200 LOC). Prefer small.

> If complexity is **large**, split the plan into smaller, independently
> shippable sub-improvements and evolve one at a time.

---

## Phase 3 — Build

**Goal**: Implement the plan precisely, passing all code gates.

### Rules (inherited from `rules/code.md`)

- Gate 1 — Clean Code: no dead code, meaningful names, no magic numbers
- Gate 2 — Good Performance: no leaks, no blocking the main thread
- Gate 3 — Self-Review: re-read every changed file top to bottom before
  declaring done

### Additional Evolve-specific constraints

- **No regressions**: All existing features must continue to work.
- **Style consistency**: Match the glassmorphism + cyberpunk aesthetic
  already present in `july.tsx`. Do not introduce new design systems.
- **Persistence**: Any new toggleable setting must be persisted to
  `localStorage` using a namespaced key (e.g., `july_featureName`).
- **Accessibility**: New interactive elements must have `aria-label` or
  visible labels.
- **Type safety**: No `any`, no unchecked assertions. The build must pass
  `npx tsc --noEmit`.

---

## Phase 4 — Verify

**Goal**: Confirm the change is correct and the codebase is healthy.

### Verification checklist

Run the following commands in order. **Stop and fix any failure before
proceeding.**

```bash
# 1. Type-check the entire project
npx tsc --noEmit

# 2. Lint and format check
npx biome check .

# 3. Confirm the dev server starts without errors (optional but recommended
#    for significant UI changes — interrupt after confirming startup)
npm run dev
```

If any command fails:
- Fix the issue immediately
- Re-run all checks from the top
- Do not proceed to Stage until all checks pass

---

## Phase 5 — Stage

**Goal**: Present the completed change to Master for review and approval.

### Steps

1. Run `git diff --stat` and `git diff` to produce a clean summary of all
   changes.
2. Compose a **Stage Report** (see `references/stage-report-template.md`)
   that includes:
   - What changed and why (the improvement opportunity)
   - Files modified
   - Verification results (pass/fail for each check)
   - A suggested conventional commit message (following `rules/commit-codes.md`)
3. Present the Stage Report to Master.
4. **Wait for explicit approval** before running any `git add`, `git commit`,
   or `git push` command.

---

## Activation

This skill activates when July hears or reads any of:

- "evolve"
- "improve yourself"
- "self-improve"
- "grow"
- "think of something to add"
- "surprise me"
- "what would you build next?"

When activated without a specific target, July runs the full five-phase loop
autonomously, starting from **Phase 1 — Discover**.

July may also be directed to start from a specific phase:
- "evolve: plan only" → skip Discover, start from Phase 2
- "evolve: build the plan" → skip to Phase 3 (requires a prior plan)
- "evolve: verify" → run Phase 4 only
- "evolve: stage" → run Phase 5 only

---

## Constraints & Safety

| Constraint | Detail |
|---|---|
| No auto-commit | Never run `git commit`, `git push`, `git add` without explicit instruction |
| One improvement at a time | Do not batch multiple features into one evolution cycle |
| Prefer reversibility | Favour changes that can be reverted with a single `git revert` |
| Respect existing rules | All code must pass the gates in `rules/code.md` |
| Commit style | Follow `rules/commit-codes.md` exactly — all lowercase conventional commits |
| Human-in-the-loop | Always present a Stage Report and wait for approval |

---

## References

- `references/scoring.md` — How to score and rank improvement candidates
- `references/evolution-log.md` — Running history of all evolution cycles
- `references/stage-report-template.md` — Template for the Stage Report
- `rules/code.md` — Code quality gates (Gate 1, 2, 3)
- `rules/commit-codes.md` — Conventional commit format rules
