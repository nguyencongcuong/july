# code rule

## non-negotiable: every implementation must pass all four gates before it is done

---

## gate 1 — clean code

code must be readable, intentional, and maintainable. no exceptions.

### rules

- **no dead code** — remove unused variables, imports, functions, refs, and commented-out blocks
- **one responsibility per unit** — functions, components, and modules do one thing well; split if they grow too large
- **meaningful names** — variables and functions must describe what they hold or do (no `tmp`, `data2`, `x`, `handler1`)
- **no magic numbers** — extract literals into named constants with a comment explaining the value
- **consistent style** — follow the project formatter (biome); never mix styles or override rules without a `biome-ignore` comment and a reason
- **no nested ternaries** — use early returns, guard clauses, or named variables instead
- **comments explain *why*, not *what*** — if the code is clear, skip the comment; if something is non-obvious, explain the reasoning

### checklist before finishing

- [ ] no unused imports or variables
- [ ] no leftover `console.log` (unless intentionally part of the feature, e.g. debugging tools)
- [ ] no TODO/FIXME left unresolved without a tracking note
- [ ] all names are clear and self-documenting
- [ ] file is formatted and lint-clean (`bunx biome check`)

---

## gate 2 — zod typings

all data shapes that cross a boundary must be defined and validated with zod. no exceptions.

### rules

- **use zod for all schemas** — any object, api response, form input, or localStorage value with a non-trivial shape must have a zod schema
- **schemas live in `libs/schemas/`** — one file per domain (e.g. `libs/schemas/chat.ts`, `libs/schemas/settings.ts`); never define schemas inline in components or actions
- **derive types from schemas** — use `z.infer<typeof MySchema>` for all TypeScript types; do not duplicate type definitions alongside a schema
- **parse at the boundary** — call `.parse()` or `.safeParse()` at every trust boundary: api responses, `localStorage` reads, server action inputs, and user-supplied data
- **use `safeParse` for recoverable errors** — when a parse failure should degrade gracefully rather than throw, use `safeParse` and handle the error explicitly
- **no `z.any()` or `z.unknown()` without a comment** — if you must use them, add a `// reason:` comment explaining why a stricter schema is not possible
- **keep schemas flat and composable** — prefer small schemas composed with `.merge()`, `.extend()`, or `.pick()` over deeply nested monoliths
- **version schemas for stored data** — if a schema is persisted to `localStorage`, include a `version` field so future migrations are possible

### checklist before finishing

- [ ] every new data shape has a schema in `libs/schemas/`
- [ ] all typescript types are derived with `z.infer` — no duplicate type declarations
- [ ] `.parse()` or `.safeParse()` is called at every trust boundary
- [ ] no `z.any()` without a `// reason:` comment
- [ ] schemas are flat and composable, not deeply nested

---

## gate 3 — good performance

never make the user feel the cost of the code.

### rules

- **no work in hot paths** — functions called on every frame, every keystroke, or every render must be lean; move expensive work outside
- **memoize correctly** — use `useCallback` / `useMemo` where referential identity matters; do not memoize trivially cheap operations (premature memoization adds noise)
- **no memory leaks** — every subscription, event listener, `setInterval`, `requestAnimationFrame`, and `AudioContext` must be torn down on unmount
- **no spread into variadic functions with large arrays** — e.g. `Math.max(...largeArray)` can overflow the call stack; use a loop instead
- **batch state updates** — avoid calling multiple `setState` in a row when one combined update or a reducer would suffice
- **avoid redundant re-renders** — state that does not affect the UI should live in a `ref`, not `useState`
- **no blocking the main thread** — heavy computation must be deferred (`requestIdleCallback`, worker, or chunked with `setTimeout`)

### checklist before finishing

- [ ] no active leak vector (timers, listeners, contexts, streams)
- [ ] hot-path functions are lightweight
- [ ] state shape is minimal — no unnecessary state that triggers re-renders
- [ ] no spread over typed arrays or large datasets

---

## gate 3 — mandatory self-review for bugs

**after every initial implementation, the agent must re-read the code once and actively look for bugs before considering the task done.**

this is not optional. do not skip it.

### what to look for

| category | examples |
|----------|---------|
| logic errors | off-by-one, wrong operator, inverted condition |
| race conditions | async state set after unmount, unguarded concurrent calls |
| missing error handling | unhandled promise rejections, missing `catch`, unchecked null |
| stale closures | `useEffect` / `useCallback` capturing outdated values |
| resource leaks | `AudioContext`, streams, timers not cleaned up |
| type unsafety | unchecked casts, implicit `any`, unsafe `!` non-null assertions |
| edge cases | empty input, zero, undefined, first/last item in list |
| api misuse | browser apis called outside gesture handler, wrong lifecycle hook |

### process

1. finish the initial implementation
2. re-read the full changed code top to bottom
3. for each issue found: fix it and note what was wrong
4. if no issues: explicitly confirm "self-review complete — no bugs found"
5. only then consider the task done

---

## summary

```
write code  →  gate 1: clean?  →  gate 2: zod schemas?  →  gate 3: performant?  →  gate 4: self-reviewed?  →  done
```

all four gates must pass. skipping any gate is not allowed.
