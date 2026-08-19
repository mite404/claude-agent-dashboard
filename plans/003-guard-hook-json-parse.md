# Plan 003: Stop hook scripts from crashing on malformed stdin

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: run
> `git diff --stat 4f0beea..HEAD -- scripts/` (the four in-scope hook scripts
> are `pre-tool-agent.ts`, `post-tool-agent.ts`, `post-tool-all.ts`,
> `session-event.ts`).
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but if running alongside Plan 002, apply 002 first to
  avoid two edits landing in `scripts/post-tool-all.ts` at once — see note)
- **Category**: bug
- **Planned at**: commit `4f0beea`, 2026-07-08
- **Covers finding**: #4 (BUG-02) from `docs/IMPROVE.md`.

## Why this matters

Claude Code pipes a JSON blob into each hook on stdin. All four hook scripts call
`JSON.parse(raw)` with no error handling, so any malformed or empty stdin throws
an uncaught exception and the hook exits non-zero. Hook failures surface to the
user as errors and can interrupt the agent flow, and because the throw happens
before any logging, the failure is opaque — nothing is written to
`logs/hooks.log`. One script,`scripts/session-event.ts`, has an extra crash: it
calls `payload.session_id.replace(...)` immediately after parsing, which throws
if `session_id` is absent even when the JSON is otherwise valid. After this plan,
a bad payload makes each hook log a diagnostic line and exit `0` (a hook that
can't parse its input has nothing useful to do; exiting cleanly is correct and
keeps the agent flow uninterrupted).

## Current state

All four files define `API_BASE`, `LOG_FILE`, and an `async function log(msg)`
that appends to `logs/hooks.log`. Because `log` is a hoisted function
declaration, it is safe to call at the parse site even where its textual
definition appears lower in the file. Confirm each `log` signature exists before
relying on it (grep in Step 1).

**`scripts/pre-tool-agent.ts`** — parse at lines 28–29 (health check precedes it
at lines 18–24):

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as PreToolPayload;
```

`log` is declared at line 108.

**`scripts/post-tool-agent.ts`** — parse at lines 41–42 (health check precedes it
at lines 32–38):

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as PostToolPayload;
```

`log` is declared at line 105.

**`scripts/post-tool-all.ts`** — parse at lines 37–38 (health check precedes it
at lines 28–34):

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as PostToolAllPayload;
```

`log` is declared at line 52.

**`scripts/session-event.ts`** — parse at lines 30–32, and this file parses
**before** its health check (which is at line 45):

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as ClaudeSessionEventPayload;
const sessionId = payload.session_id.replace(/[^a-zA-Z0-9_-]/g, '');
```

`log` is declared at line 35. Note the third line dereferences
`payload.session_id` unconditionally — it must become null-safe.

Convention: 2-space indent, single quotes, `async/await`, `process.exit(0)` for
clean early exits (see the `if (!isServerUp) process.exit(0)` pattern already in
every file). Match it.

## Commands you will need

| Purpose      | Command                          | Expected on success |
|--------------|----------------------------------|---------------------|
| Typecheck    | `bunx tsc --noEmit`              | exit 0, no errors   |
| Lint         | `bun run lint`                   | exit 0 (7 pre-existing warnings OK) |
| Tests        | `bunx vitest run`                | 133 passed          |

## Scope

**In scope** (the only files you should modify):

- `scripts/pre-tool-agent.ts`
- `scripts/post-tool-agent.ts`
- `scripts/post-tool-all.ts`
- `scripts/session-event.ts`

**Out of scope** (do NOT touch):

- `scripts/post-task.ts`, `scripts/pr-watcher.ts`, `scripts/pre-tool-all.ts`,
  `scripts/spawn-terminal.ts` — not part of this finding.
- The health-check URL in `scripts/post-tool-all.ts` — that is Plan 002. If Plan
  002 hasn't landed, leave the `/api/tasks` string alone here; only wrap the
  parse.
- Any change to the payload TypeScript interfaces — keep them; you are adding a
  runtime guard, not changing types.

## Git workflow

- Branch `<user>/<slug>`, e.g. `mite404/guard-hook-json-parse`.
- Commit message: `fix: guard JSON.parse in hook scripts against malformed stdin`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the `log` helper exists in each file

Run:

```bash
grep -n "async function log" scripts/pre-tool-agent.ts \
  scripts/post-tool-agent.ts scripts/post-tool-all.ts scripts/session-event.ts
```

**Verify**: four matches, one per file. If any file lacks it, STOP — the guard in
Step 2 relies on `log` being callable.

### Step 2: Wrap each `JSON.parse` in a try/catch

In each of the four files, replace the bare
`const payload = JSON.parse(raw) as <Type>;` with a guarded version that logs and
exits 0 on failure. Target shape (substitute the file's own `<Type>`):

```ts
let payload: <Type>;
try {
  payload = JSON.parse(raw) as <Type>;
} catch {
  await log('SKIP: malformed JSON on stdin');
  process.exit(0);
}
```

The concrete `<Type>` per file:

- `pre-tool-agent.ts` → `PreToolPayload`
- `post-tool-agent.ts` → `PostToolPayload`
- `post-tool-all.ts` → `PostToolAllPayload`
- `session-event.ts` → `ClaudeSessionEventPayload`

Note on `post-tool-all.ts`: its health check runs *before* the parse and exits 0
if the server is down, so the catch here is reached only when the server is up
and stdin is malformed — still correct.

**Verify**: `bunx tsc --noEmit` → exit 0. (`payload` is used later in each file;
declaring it with `let` and assigning in the `try` keeps it in scope.)

### Step 3: Make `session-event.ts` null-safe on `session_id`

In `scripts/session-event.ts`, after the guarded parse, change the `session_id`
dereference to tolerate a missing field:

```ts
const sessionId = (payload.session_id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
```

**Verify**: `bunx tsc --noEmit` → exit 0.

## Test plan

No unit harness exists for stdin-driven entry scripts. Verify by piping malformed
input and asserting a clean exit.

`session-event.ts` parses **before** its health check, so it can be tested with
the server **down** (simplest):

```
echo 'this is not json' | bun scripts/session-event.ts --event-type SessionStart; echo "exit=$?"
```

→ prints `exit=0` (before this plan: non-zero, with a `SyntaxError` stack trace).
Also test the missing-`session_id` path (valid JSON, no field):

```
echo '{"type":"SessionStart"}' | bun scripts/session-event.ts --event-type SessionStart; echo "exit=$?"
```

→ prints `exit=0` (before this plan: throws on `.replace` of undefined).

The other three health-check **before** parsing, so their catch is only reached
with the server up. Start it first (`bun run server &`), then:

```
echo 'not json' | bun scripts/pre-tool-agent.ts; echo "exit=$?"
echo 'not json' | bun scripts/post-tool-agent.ts; echo "exit=$?"
echo 'not json' | bun scripts/post-tool-all.ts; echo "exit=$?"
```

→ each prints `exit=0`, and `tail logs/hooks.log` shows a
`SKIP: malformed JSON on stdin` line from each. Stop the server when done.

(If you cannot start the server, at minimum the `session-event.ts` checks above
plus a clean `bunx tsc --noEmit` are required; note in your report that the
other three were verified by code inspection only.)

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "JSON.parse" scripts/` shows each of the four hook scripts'
      parse inside a `try` block (each `JSON.parse` line preceded by `try {`)
- [ ] `grep -n "payload.session_id ?? ''" scripts/session-event.ts` returns a match
- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun run lint` exits 0 with no new warnings
- [ ] `bunx vitest run` → 133 passed (unchanged)
- [ ] `echo 'x' | bun scripts/session-event.ts --event-type SessionStart` exits 0
- [ ] No files outside the four in-scope scripts are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any file's excerpt doesn't match the live code (drift since `4f0beea`).
- `tsc` reports `payload` "used before assigned" — this means the file uses
  `payload` in a way the `let` + try/catch pattern doesn't cover; report the exact
  error rather than forcing a non-null assertion.
- A `log` helper is missing in a file (Step 1 failed) — the guard can't log; do
  not silently drop the message.

## Maintenance notes

- Any *new* hook script added under `scripts/` should follow the same guarded-parse
  pattern; consider extracting a tiny `readPayload<T>()` helper in a follow-up if a
  fifth hook appears (not worth it for four).
- A reviewer should confirm each catch exits `0` (not `1`) — a non-zero exit from
  a hook is exactly the interruption this plan removes.
- This plan hardens the parse only; it does not validate payload *shape* beyond
  what the existing destructuring defaults already handle. Deeper schema
  validation (e.g. zod) is deliberately out of scope.
