# Evolution Log

This file records every evolution cycle July has completed. It is the source
of truth for what has already been done, so duplicates are avoided.

Append a new entry at the **bottom** of this file after every completed
Phase 1 — Discover. Never delete or overwrite existing entries.

---

## Entry Format

```
## [YYYY-MM-DD] — <Opportunity Title>

**Phase**: discover | plan | build | verify | stage | done
**Score**: <Total Score> / 45
**Reasoning**: <Why this was the best candidate>
**Scope**: <Files expected to change>
**Outcome**: <Filled in after Stage — what was actually done>
```

---

<!-- Evolution entries will be appended below this line -->

## [2026-06-20] — Automatic Retry with Exponential Backoff for Failed API Calls

**Phase**: done
**Score**: 42 / 45
**Reasoning**: When `talk()` or `talkText()` throws, July currently shows an error
banner and gives up permanently. Adding up to 2 automatic retries with 500ms / 1500ms
exponential backoff makes July resilient to transient network errors with no new
dependencies. The `requestIdRef` guard already prevents stale-response races.
Change is entirely within `july.tsx`, estimated ~35 LOC, single `git revert`–safe.
**Scope**: `libs/components/july.tsx` (modify — retry helper + updated catch blocks)
**Outcome**: Implemented `withRetry` helper (2 retries, 500ms/1500ms backoff).
Both `stopRecordingAndTranscribe` and `handlePrompt` now use it. Error banner shows
"Retrying… (attempt N/2)" during backoff. All tsc + biome checks passed. Committed.
