# Plan 003: Stop hook scripts from crashing on malformed stdin

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
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
- **Depends on**: none. If running alongside Plan 002, apply 002 first so two
  edits don't land in `scripts/post-tool-all.ts` at once (see the note in Step 2).
- **Category**: bug
- **Planned at**: commit `4f0beea`, 2026-07-08
- **Covers finding**: #4 (BUG-02) from `docs/IMPROVE.md`.

## Why this matters

Claude Code pipes a JSON blob into each hook on stdin. All four hook scripts call
`JSON.parse(raw)` with no error handling, so malformed or empty stdin throws an
uncaught exception and the hook exits non-zero. Claude Code reports that to the user
as a hook error, which interrupts the agent. The throw happens before any logging
runs, so nothing reaches `logs/hooks.log` and there is no record of what arrived.

`scripts/session-event.ts` has a second crash on top of that one. It calls
`payload.session_id.replace(...)` immediately after parsing, which throws when
`session_id` is absent even though the JSON itself parsed fine.

After this plan, a bad payload makes each hook write one diagnostic line and exit
`0`. Exit 0 is the right code here: a hook that cannot parse its input has no work to
do, and a non-zero exit is the interruption this plan exists to remove.

## Current state

All four files define `API_BASE`, `LOG_FILE`, and an `async function log(msg)` that
appends to `logs/hooks.log`. `log` is a hoisted function declaration, so calling it
above its own definition works. Step 1 greps for it before you rely on that.

**`scripts/pre-tool-agent.ts`**, parse at lines 28-29. The health check precedes it
at lines 18-24.

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as PreToolPayload;
```

`log` is declared at line 108.

**`scripts/post-tool-agent.ts`**, parse at lines 41-42. The health check precedes it
at lines 32-38.

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as PostToolPayload;
```

`log` is declared at line 105.

**`scripts/post-tool-all.ts`**, parse at lines 37-38. The health check precedes it
at lines 28-34.

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as PostToolAllPayload;
```

`log` is declared at line 52.

**`scripts/session-event.ts`**, parse at lines 30-32. This file parses _before_ its
health check, which sits at line 45.

```ts
const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as ClaudeSessionEventPayload;
const sessionId = payload.session_id.replace(/[^a-zA-Z0-9_-]/g, "");
```

`log` is declared at line 35. The third line dereferences `payload.session_id`
unconditionally, so it has to become null-safe. Step 3 covers that.

Convention: 2-space indent, single quotes, `async/await`, and `process.exit(0)` for
clean early exits. The `if (!isServerUp) process.exit(0)` pattern already in every
file is the model. Match it.

## Commands you will need

| Purpose   | Command             | Expected on success                 |
| --------- | ------------------- | ----------------------------------- |
| Typecheck | `bunx tsc --noEmit` | exit 0, no errors                   |
| Lint      | `bun run lint`      | exit 0 (7 pre-existing warnings OK) |
| Tests     | `bunx vitest run`   | 133 passed                          |

## Scope

**In scope** (the only files you should modify):

- `scripts/pre-tool-agent.ts`
- `scripts/post-tool-agent.ts`
- `scripts/post-tool-all.ts`
- `scripts/session-event.ts`

**Out of scope** (do NOT touch):

- `scripts/post-task.ts`, `scripts/pr-watcher.ts`, `scripts/pre-tool-all.ts`,
  `scripts/spawn-terminal.ts`. Not part of this finding.
- The health-check URL in `scripts/post-tool-all.ts`. That is Plan 002. If Plan 002
  hasn't landed, leave the `/api/tasks` string alone and only wrap the parse.
- The payload TypeScript interfaces. Keep them as they are. You are adding a runtime
  guard, not changing types.

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

**Verify**: four matches, one per file. If any file lacks it, STOP. The guard in
Step 2 calls `log`, so it cannot land without one.

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

Note on `post-tool-all.ts`: its health check runs _before_ the parse and exits 0 when
the server is down, so this catch only fires with the server up and stdin malformed.
Add it anyway. It costs nothing on the server-down path, because the script has
already exited by then.

**Verify**: `bunx tsc --noEmit` → exit 0. (`payload` is used later in each file;
declaring it with `let` and assigning in the `try` keeps it in scope.)

### Step 3: Make `session-event.ts` null-safe on `session_id`

In `scripts/session-event.ts`, after the guarded parse, change the `session_id`
dereference to tolerate a missing field:

```ts
const sessionId = (payload.session_id ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
```

**Verify**: `bunx tsc --noEmit` → exit 0.

## Test plan

No unit harness exists for stdin-driven entry scripts. Test by piping malformed input
and checking the exit code.

`session-event.ts` parses before its health check, so it tests with the server down.
Start there.

```
echo 'this is not json' | bun scripts/session-event.ts --event-type SessionStart; echo "exit=$?"
```

→ prints `exit=0`. Before this plan: non-zero, with a `SyntaxError` stack trace.

Then the missing-`session_id` path, which is valid JSON with the field absent:

```
echo '{"type":"SessionStart"}' | bun scripts/session-event.ts --event-type SessionStart; echo "exit=$?"
```

→ prints `exit=0`. Before this plan: throws on `.replace` of undefined.

The other three run their health check before parsing, so their catch only fires with
the server up. Start it first (`bun run server &`), then:

```
echo 'not json' | bun scripts/pre-tool-agent.ts; echo "exit=$?"
echo 'not json' | bun scripts/post-tool-agent.ts; echo "exit=$?"
echo 'not json' | bun scripts/post-tool-all.ts; echo "exit=$?"
```

→ each prints `exit=0`, and `tail logs/hooks.log` shows one
`SKIP: malformed JSON on stdin` line per script. Stop the server when done.

If you cannot start the server, the two `session-event.ts` checks above plus a clean
`bunx tsc --noEmit` are the minimum. Say in your report that the other three were
verified by inspection only.

## Done criteria

Machine-checkable. ALL must hold:

- [x] `grep -rn "JSON.parse" scripts/` shows each of the four hook scripts'
      parse inside a `try` block (each `JSON.parse` line preceded by `try {`)
- [x] `grep -n "payload.session_id ?? ''" scripts/session-event.ts` returns a match
- [x] `bunx tsc --noEmit` exits 0
- [x] `bun run lint` exits 0 with no new warnings
- [x] `bunx vitest run` → 133 passed (unchanged)
- [x] `echo 'x' | bun scripts/session-event.ts --event-type SessionStart` exits 0
- [ ] No files outside the four in-scope scripts are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any file's excerpt doesn't match the live code (drift since `4f0beea`).
- `tsc` reports `payload` "used before assigned". That means the file uses `payload`
  somewhere the `let` + try/catch pattern doesn't cover. Report the exact error
  instead of forcing a non-null assertion.
- A `log` helper is missing in a file (Step 1 failed). The guard cannot log without
  one, and dropping the message silently is worse than stopping.

## Maintenance notes

- Any new hook script under `scripts/` should use the same guarded-parse pattern. If
  a fifth hook appears, extract a `readPayload<T>()` helper. Not worth it for four.
- A reviewer should confirm each catch exits `0`, not `1`. A non-zero exit from a
  hook is the interruption this plan removes.
- This plan guards the parse only. It does not validate payload shape beyond what the
  existing destructuring defaults handle. Schema validation with zod is deliberately
  out of scope.
