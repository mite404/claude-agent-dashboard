# Plan 002: Fix the PostToolUse-all hook so it stops silently no-op-ing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4f0beea..HEAD -- scripts/post-tool-all.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4f0beea`, 2026-07-08
- **Covers finding**: #3 (BUG-01) from `docs/IMPROVE.md`.

## Why this matters

`scripts/post-tool-all.ts` is the Claude Code PostToolUse hook that marks
non-Agent tool events completed or failed on the running task. Its first action
is a server health check against `http://localhost:3001/api/tasks`. But the Hono
server registers `/tasks`, **not** `/api/tasks` — the `/api` prefix exists only
in Vite's dev proxy, which hooks don't go through. So the HEAD request always
404s, `r.ok` is false, and the hook exits `0` before doing any work. Every other
hook script correctly uses `/tasks`. The net effect: this hook has silently done
nothing since the `/api` typo was introduced. There is also a latent second
crash: if the hook ever got past the health check, it reads `existing.events`
and calls `.map` on it, but `GET /tasks` doesn't return an `events` field
(a separately-tracked bug), so `events` is `undefined` and `.map` throws. This
plan fixes the health check so the hook runs, and guards the `.map` so a running
hook can't crash on the missing field.

## Current state

`scripts/post-tool-all.ts` — PostToolUse hook, fires on all tools. Relevant
excerpts:

The broken health check (lines 28–34):

```ts
const isServerUp = await fetch(`${API_BASE}/api/tasks`, { method: 'HEAD' })
  .then((r) => r.ok)
  .catch(() => false);

if (!isServerUp) {
  process.exit(0);
}
```

`API_BASE` is defined at line 16 as `'http://localhost:3001'`.

The correct pattern, for reference, from `scripts/session-event.ts:45`
(do NOT edit that file — it is shown only as the exemplar):

```ts
const isServerUp = await fetch(`${API_BASE}/tasks`, { method: 'HEAD' })
```

The unguarded `.map` (lines 96–101):

```ts
const events =
  (existing as unknown as Record<string, unknown>).events as Array<Record<string, unknown>>;

const updatedEvents = events.map((e) =>
  e.id === eventId ? { ...e, phase: 'post', status: finalStatus, completedAt: now } : e,
);
```

Here `existing` is a `Task` fetched from `GET /tasks?...`; that response has no
`events` field today, so `events` is `undefined` and `.map` would throw.

## Commands you will need

| Purpose      | Command                          | Expected on success |
|--------------|----------------------------------|---------------------|
| Typecheck    | `bunx tsc --noEmit`              | exit 0, no errors   |
| Lint         | `bun run lint`                   | exit 0 (7 pre-existing warnings OK) |
| Tests        | `bunx vitest run`                | 133 passed          |
| Run the hook | (see Test plan — pipes JSON into `bun scripts/post-tool-all.ts`) | exit 0 |

## Scope

**In scope** (the only file you should modify):

- `scripts/post-tool-all.ts`

**Out of scope** (do NOT touch):

- `src/server.ts` — the missing `events` JOIN on `GET /tasks` is a separate,
  already-tracked finding (`docs/061526-latest-bugs.md`); this plan only makes
  the hook *survive* the missing field, it does not add the JOIN. Do not add it
  here.
- `scripts/session-event.ts` and the other hook scripts — shown as exemplars
  only; their `JSON.parse` hardening is Plan 003, not this plan.
- `vite.config.ts` — the `/api` proxy is correct for the browser; the hook simply
  shouldn't use the proxied path.

## Git workflow

- Branch `<user>/<slug>`, e.g. `mite404/fix-posttool-all-healthcheck`.
- Commit message: `fix: post-tool-all hook uses /tasks health check and guards events`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Correct the health-check URL

In `scripts/post-tool-all.ts` line 28, change `/api/tasks` to `/tasks`:

```ts
const isServerUp = await fetch(`${API_BASE}/tasks`, { method: 'HEAD' })
  .then((r) => r.ok)
  .catch(() => false);
```

**Verify**: `grep -n "/api/tasks" scripts/post-tool-all.ts` → no matches.

### Step 2: Guard the `events` array against `undefined`

In `scripts/post-tool-all.ts` lines 96–97, default `events` to an empty array so
`.map` cannot throw when the field is absent:

```ts
const events =
  ((existing as unknown as Record<string, unknown>).events as Array<Record<string, unknown>>) ??
  [];
```

**Verify**: `bunx tsc --noEmit` → exit 0.

## Test plan

No unit-test harness exists for `scripts/*` entry scripts, and adding one for a
stdin-driven hook is disproportionate. Verify by running the hook against a live
server with a real payload:

1. Start the API server in the background: `bun run server &` — wait for it to be
   listening on 3001 (`lsof -nP -iTCP:3001 -sTCP:LISTEN` shows a LISTEN row).
2. **Health check now passes** — pipe a minimal valid payload and confirm the
   hook exits 0 and reaches its lookup logic instead of bailing at the health
   check:

   ```
   echo '{"tool_name":"Read","tool_use_id":"t1","session_id":"s1"}' \
     | bun scripts/post-tool-all.ts; echo "exit=$?"
   ```

   → prints `exit=0`. Then check the log shows it ran past the health check:

   ```
   tail -n 3 logs/hooks.log
   ```

   → contains a `[post-all]` line such as `SKIP: no active task found ...`
   (this proves the hook executed its body rather than silently exiting at the
   health check — before this plan there would be **no** new `[post-all]` line
   at all).
3. **No crash on missing `events`** — the fact that step 2 exits 0 and logs a
   `[post-all]` line (rather than a non-zero exit / stack trace) confirms the
   Step 2 guard holds even though `GET /tasks` returns no `events` field.
4. Stop the background server.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "/api/tasks" scripts/post-tool-all.ts` returns no matches
- [ ] `grep -n "?? \[\]" scripts/post-tool-all.ts` returns at least one match
      (the events guard)
- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun run lint` exits 0 with no new warnings
- [ ] `bunx vitest run` → 133 passed (unchanged)
- [ ] Test-plan step 2 prints `exit=0` and a new `[post-all]` line appears in
      `logs/hooks.log`
- [ ] No files outside `scripts/post-tool-all.ts` are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift since `4f0beea`).
- With the server running, the hook still exits before logging a `[post-all]`
  line — something else in the health-check path is wrong.
- `GET /tasks` has started returning an `events` field (the tracked JOIN bug was
  fixed independently) — the `?? []` guard is still correct and harmless, but note
  it so the reviewer knows the second half of this finding is now moot.

## Maintenance notes

- When the `GET /tasks` `events` JOIN is eventually added (the tracked P1), this
  hook's `.map` will finally operate on real data — the `?? []` guard stays
  correct and should not be removed.
- A reviewer should confirm no other script still references `/api/` against the
  hook API (`grep -rn "/api/tasks" scripts/` should be empty after this plan).
- Deferred: this plan does not verify the hook's *downstream* PATCH actually
  updates event status end-to-end (that depends on the JOIN bug). It only ensures
  the hook runs and cannot crash.
