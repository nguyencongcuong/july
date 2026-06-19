# commit-codes skill

## 🚫 non-negotiable: never commit or push automatically

> **the agent must never run `git commit`, `git push`, `git add`, or any git write command on its own.**
> only execute these commands when the user explicitly asks (e.g. "commit", "push", "commit and push").
> finishing a coding task does **not** imply permission to commit.

---

## rule: always use conventional commits — all lowercase, no exceptions

---

## commit message format

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**every part of the commit message must be lowercase — type, scope, description, body, and footer.**

---

## allowed types

| type | when to use |
|------|-------------|
| `feat` | a new feature |
| `fix` | a bug fix |
| `docs` | documentation changes only |
| `style` | formatting, missing semicolons, etc. — no logic change |
| `refactor` | code change that neither fixes a bug nor adds a feature |
| `perf` | performance improvements |
| `test` | adding or updating tests |
| `build` | changes to build system or external dependencies |
| `ci` | changes to ci/cd configuration or scripts |
| `chore` | maintenance tasks, dependency updates, tooling |
| `revert` | reverts a previous commit |

---

## rules

1. **always lowercase** — type, scope, description, body, footer — no capitals anywhere
2. **type is required** — must be one of the types listed above
3. **scope is optional** — use a short noun in parentheses describing the affected area, e.g. `(auth)`, `(api)`, `(ui)`
4. **description is required** — imperative mood, present tense, no period at the end
5. **description must be short** — 72 characters max
6. **no capital letters** — not even at the start of the description
7. **body is optional** — use to explain *what* and *why*, not *how*; wrap at 72 characters
8. **footer is optional** — use for breaking changes (`breaking change: <description>`) or issue references (`closes #123`)
9. **breaking changes** — add `!` after the type/scope and include a `breaking change:` footer

---

## examples

### ✅ correct

```
feat(auth): add google oauth login
```

```
fix(api): handle null response from user endpoint
```

```
docs: update readme with setup instructions
```

```
refactor(ui): extract button component from dashboard
```

```
chore: bump eslint to v9
```

```
feat(payments)!: replace stripe with braintree

breaking change: stripe webhook endpoint removed. migrate to /webhooks/braintree
```

```
fix(cache): resolve race condition on concurrent writes

the previous implementation did not lock the cache before writing,
causing intermittent data corruption under high concurrency.

closes #87
```

---

### ❌ incorrect — do not do this

```
# capital letter in description
feat(auth): Add Google OAuth Login

# capital type
Fix: handle null response

# missing type
update readme

# period at end
fix(api): handle null response.

# vague description
fix: stuff

# past tense
feat: added login button
```

---

## breaking change format

```
<type>(<scope>)!: <short description>

<body explaining what changed>

breaking change: <what broke and how to migrate>
```

---

## multi-line body guidelines

- separate body from subject with a blank line
- use imperative, present-tense language
- explain the *motivation* for the change
- all lines must be lowercase
- wrap lines at 72 characters

---

## scope guidelines

- use the module, package, or feature name
- keep it short and consistent across the project
- examples: `auth`, `api`, `ui`, `db`, `config`, `ci`, `docs`, `tests`

---

## quick reference cheatsheet

```
feat:      new feature
fix:       bug fix
docs:      docs only
style:     formatting
refactor:  no feat/fix
perf:      performance
test:      tests
build:     build system
ci:        ci config
chore:     maintenance
revert:    undo commit
```
