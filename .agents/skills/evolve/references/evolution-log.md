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

## [2026-06-20] — Persistent Chat History via localStorage

**Phase**: done
**Score**: 41 / 45
**Reasoning**: All messages were lost on every page refresh. Persisting to
`july_chat_history` in localStorage gives huge user value with zero new
dependencies. Init reads from storage, a single `useEffect` writes on
every messages change. Corrupt JSON and quota errors are caught silently.
Single-file change (~23 LOC), fully reversible with `git revert`.
**Scope**: `libs/components/july.tsx` (modify — messages lazy init + persist effect)
**Outcome**: Messages now survive page refreshes. Clearing chat (button or Cmd+K)
naturally writes an empty array, also clearing stored history. All tsc + biome
checks passed. Committed and pushed (d495f11).

## [2026-06-20] — Typewriter Animation for July Responses

**Phase**: done
**Score**: 40 / 45
**Reasoning**: New July messages appear all-at-once, making the UI feel static.
A letter-by-letter typewriter effect at 20ms/char (~50 chars/sec) with a blinking
block cursor makes the interface feel premium and alive. No new deps — pure
setInterval + useRef. Persisted history on mount is skipped via hasMountedRef.
The prevMessagesCountRef guard ensures animation only fires on genuine appends.
**Scope**: `libs/components/july.tsx` (modify — state + refs + effect + CSS + render)
**Outcome**: July responses now type out character-by-character with a green blinking
cursor. History loaded from localStorage on mount is shown immediately without
animation. tsc + biome checks passed. Committed and pushed (ae2dfa6).

## [2026-06-20] — Keyboard Shortcut to Toggle Help Modal

**Phase**: done
**Score**: 40 / 45
**Reasoning**: Currently, the interaction guide / Help Modal can only be opened by clicking the keyboard shortcuts helper at the bottom, and closed via Escape or clicking the backdrop. Adding the 'H' key as a global toggle shortcut makes accessing and closing the help documentation seamless, and keeps it consistent with other shortcuts (M, S, Esc). Change is extremely self-contained, low risk, < 15 LOC, and completely safe.
**Scope**: `libs/components/july.tsx` (modify — keydown event listener, shortcuts helper UI, and documented shortcuts list)
**Outcome**: Keyboard shortcut 'H' (or 'h') now toggles the Help Modal when not typing in text fields. Added '[H] Help' to the bottom status helper bar and documented 'H' in the Help Modal shortcut listing. Both tsc and biome check passed without errors.




