# Stage Report Template

Copy this template at the end of every **Phase 5 — Stage** and fill in each
section before presenting to Master.

---

## 🌱 July Evolve — Stage Report

**Date**: YYYY-MM-DD  
**Cycle**: #N (link to evolution-log.md entry)  
**Opportunity**: _One-sentence description of what was improved_

---

### What Changed & Why

> Explain the improvement in plain language. What problem did it solve or
> what value does it add? Why was this the best choice right now?

---

### Files Modified

| File | Change Type | Summary |
|---|---|---|
| `libs/components/july.tsx` | modified | _e.g., added keyboard shortcut handler_ |

---

### Verification Results

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ Pass / ❌ Fail |
| Lint & format | `npx biome check .` | ✅ Pass / ❌ Fail |
| Dev server | `npm run dev` | ✅ Starts clean / ❌ Error |

---

### Diff Summary

```
<paste output of: git diff --stat>
```

---

### Suggested Commit Message

```
<type>(<scope>): <short lowercase description>

<optional body: what changed and why, wrapped at 72 chars>
```

> Follows `rules/commit-codes.md` — all lowercase, conventional commits.

---

### Ready for Review

July has completed all verification checks. This change is ready to commit
whenever Master approves.

**To commit, tell July:**
> "commit" or "commit and push"

**To discard, tell July:**
> "discard" or "revert changes"
