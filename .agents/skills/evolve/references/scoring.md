# Candidate Scoring Rubric

Use this rubric during **Phase 1 — Discover** to rank improvement candidates
objectively. Score each candidate on the five dimensions below (1–5 each).
The candidate with the highest **Total Score** is selected.

---

## Dimensions

### 1. User Value (weight × 3)
How directly does this improve Master's experience with July?

| Score | Meaning |
|---|---|
| 5 | Directly removes friction or adds a clearly desired capability |
| 4 | Noticeable quality-of-life improvement |
| 3 | Nice to have; moderate impact |
| 2 | Minor, rarely encountered |
| 1 | Cosmetic only or purely internal |

### 2. Confidence (weight × 2)
How confident is July that this change is correct and safe?

| Score | Meaning |
|---|---|
| 5 | Fully understood; no ambiguity; precedent exists in codebase |
| 4 | Well-understood; minor unknowns |
| 3 | Mostly clear; some research needed |
| 2 | Significant unknowns; risk of regression |
| 1 | Experimental; high uncertainty |

### 3. Scope (weight × 2)
How contained is the change?

| Score | Meaning |
|---|---|
| 5 | Single file, < 30 LOC |
| 4 | 1–2 files, 30–80 LOC |
| 3 | 2–3 files, 80–150 LOC |
| 2 | 3+ files, 150–250 LOC |
| 1 | Sweeping cross-cutting change |

### 4. Novelty (weight × 1)
Has this not been done recently?

| Score | Meaning |
|---|---|
| 5 | Completely new ground |
| 3 | Related to past work but meaningfully different |
| 1 | Recently done or duplicate of a recent commit |

### 5. Reversibility (weight × 1)
Can this be undone easily if it causes problems?

| Score | Meaning |
|---|---|
| 5 | Single `git revert` is sufficient |
| 3 | Requires minor manual cleanup to revert |
| 1 | Hard to undo; touches data or external systems |

---

## Formula

```
Total Score = (UserValue × 3) + (Confidence × 2) + (Scope × 2) + (Novelty × 1) + (Reversibility × 1)
Max possible = (5×3) + (5×2) + (5×2) + (5×1) + (5×1) = 45
```

---

## Example Scorecard

| Candidate | UserValue | Confidence | Scope | Novelty | Reversibility | Total |
|---|---|---|---|---|---|---|
| Add keyboard shortcut to clear chat | 4 | 5 | 5 | 5 | 5 | 12+10+10+5+5 = **42** |
| Refactor audio pipeline to workers | 2 | 2 | 1 | 5 | 2 | 6+4+2+5+2 = **19** |

Always pick the highest scorer. In a tie, prefer higher **UserValue**.

---

## Candidate Ideas Seed List

Use this as inspiration during discovery. This is not exhaustive.

### UX & Interaction
- Keyboard shortcuts (clear chat, submit, focus input, open settings)
- Typewriter / streaming text effect for July's responses
- Animated thinking indicator while waiting for Gemini response
- Toast notifications for settings saves and resets
- Drag-to-resize the chat panel
- Persistent chat history across page reloads (localStorage)
- Message timestamps on hover
- Copy-to-clipboard button on each message
- Emoji reactions or quick reply buttons

### Audio & Voice
- Visual waveform animation during recording
- Silence detection threshold auto-calibration
- Voice activity detection (VAD) refinement
- Speed control for TTS playback
- Mute/unmute shortcut key

### Intelligence & Prompts
- Contextual prompt suggestions based on conversation topic
- Automatic conversation title generation
- Smarter system prompt with more of July's personality
- Response length preference setting (concise vs. detailed)
- Memory injection: remind July of previous key facts

### Performance & Reliability
- Debounced auto-save of draft input
- Retry logic for failed Gemini API calls
- Graceful degradation when ElevenLabs TTS fails
- Lazy loading for settings panel contents

### Developer & Diagnostics
- Expand diagnostics grid with token count display
- Export diagnostics as JSON for debugging
- Display model latency in ms per message
