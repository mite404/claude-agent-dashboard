# Plan 001: Bind the dev servers to loopback and reject cross-origin spawn requests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4f0beea..HEAD -- scripts/spawn-terminal.ts src/server.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4f0beea`, 2026-07-08
- **Covers findings**: #1 (SEC-02, spawn CSRF) and #2 (SEC-01, all-interface bind)
  from `docs/IMPROVE.md`.

## Why this matters

This is a local dev tool with no authentication — an accepted trade-off _only_
if the servers are truly reachable from the local machine alone. Two facts break
that assumption. First, `scripts/spawn-terminal.ts` runs
`Bun.spawn(['osascript','-e',script])` — which opens a terminal and types
`claude` — for **any** POST to `/spawn`; its CORS header only controls whether a
page can _read the response_, not whether the terminal-spawning side effect
fires. So any website the developer visits can `fetch('http://localhost:3002/spawn', {method:'POST'})`
and launch a local terminal. Second, both `Bun.serve` (spawn server, :3002) and
the exported Hono server (:3001) omit `hostname`, so Bun binds `0.0.0.0` — every
machine on the LAN can reach them. After this plan, both servers listen on
loopback only, and the spawn endpoint fires its side effect only for requests
that actually originate from the dashboard UI.

## Current state

- `scripts/spawn-terminal.ts` — the terminal-spawn server (:3002). The whole
  file (58 lines). Relevant excerpts:

  Top (lines 1–5):

  ```ts
  const PORT = 3002;
  const cors = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  ```

  The server (lines 43–58):

  ```ts
  Bun.serve({
    port: PORT,
    fetch(req) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method === 'POST' && new URL(req.url).pathname === '/spawn') {
        const terminal = detectTerminal();
        const script = buildScript(terminal);
        Bun.spawn(['osascript', '-e', script]);
        return new Response(JSON.stringify({ ok: true, terminal }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`Spawn server on http://localhost:${PORT}`);
  ```

- `src/server.ts` — the Hono task API (:3001). The default export at the very
  bottom (lines 490–495):

  ```ts
  const PORT = typeof Bun.env.PORT === 'string' ? parseInt(Bun.env.PORT) : 3000;

  export default {
    fetch: app.fetch,
    port: PORT,
  };
  ```

- The **only** legitimate caller of `/spawn` is
  `src/components/TaskTable.tsx:1206` (do NOT modify it):

  ```ts
  void fetch('http://localhost:3002/spawn', { method: 'POST' }).catch(console.error);
  ```

  This is a header-less, cross-origin (5173 → 3002) POST. It is a CORS "simple
  request", so the browser sends it without a preflight **and** attaches
  `Origin: http://localhost:5173`. That header is what the origin check in Step 2
  keys on — the real caller passes; a page on any other origin (or a header-less
  `curl`) is rejected.

Convention note: this file uses `Bun.serve` and `Bun.spawn` with 2-space
indentation and single quotes — match it. The project's AGENTS.md says the main
app must not use `Bun.serve`, but `spawn-terminal.ts` is a standalone helper
process that legitimately does; leave that as-is, only add the guard.

## Commands you will need

| Purpose         | Command                                         | Expected on success                              |
| --------------- | ----------------------------------------------- | ------------------------------------------------ |
| Typecheck       | `bunx tsc --noEmit`                             | exit 0, no errors                                |
| Lint            | `bun run lint`                                  | exit 0 (7 pre-existing warnings OK; no new ones) |
| Tests           | `bunx vitest run`                               | 133 passed                                       |
| Start spawn srv | `bun scripts/spawn-terminal.ts` (background it) | prints "Spawn server on <http://localhost:3002>" |

## Scope

**In scope** (the only files you should modify):

- `scripts/spawn-terminal.ts`
- `src/server.ts`

**Out of scope** (do NOT touch, even though they look related):

- `src/components/TaskTable.tsx` — the caller stays exactly as-is; the guard is
  designed around its current header-less request. Changing it is unnecessary and
  risks breaking the very request the guard must allow.
- The `cors` object's existing values — keep `http://localhost:5173`; reuse it,
  don't redefine the origin elsewhere.
- Any auth/token scheme — out of scope for this plan; loopback + origin check is
  the agreed fix.

## Git workflow

- Branch off the current branch; the repo names branches `<user>/<slug>`
  (e.g. `mite404/bump-deps`). A name like `mite404/harden-servers` is fine.
- Commit style is conventional-ish (`fix:`, `feat:`); example from history:
  `fix: add explicit type annotations and void operators (#54)`. Use
  `fix: bind dev servers to loopback and gate /spawn by origin`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bind both servers to loopback

In `src/server.ts`, add `hostname: '127.0.0.1'` to the default export object:

```ts
export default {
  fetch: app.fetch,
  port: PORT,
  hostname: '127.0.0.1',
};
```

In `scripts/spawn-terminal.ts`, add `hostname: '127.0.0.1'` to the `Bun.serve`
config:

```ts
Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    // ... unchanged
```

**Verify**: `bunx tsc --noEmit` → exit 0, no errors.

### Step 2: Reject non-dashboard origins on `/spawn`

In `scripts/spawn-terminal.ts`, define an allowed-origin constant next to the
`cors` object (reuse the same string):

```ts
const ALLOWED_ORIGIN = 'http://localhost:5173';
```

Then, inside the `POST /spawn` branch, **before** `detectTerminal()`/`Bun.spawn`,
add an origin check. The target shape:

```ts
if (req.method === 'POST' && new URL(req.url).pathname === '/spawn') {
  const origin = req.headers.get('origin');
  if (origin !== ALLOWED_ORIGIN) {
    return new Response(JSON.stringify({ error: 'forbidden origin' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  const terminal = detectTerminal();
  const script = buildScript(terminal);
  Bun.spawn(['osascript', '-e', script]);
  return new Response(JSON.stringify({ ok: true, terminal }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
```

Rationale to preserve: the real UI caller is cross-origin, so the browser
attaches `Origin: http://localhost:5173` — it passes. A malicious page sends its
own origin (rejected); a header-less `curl` sends no origin (rejected). This is
the intended behavior.

**Verify**: `bunx tsc --noEmit` → exit 0. Then run the manual check in the Test
plan below.

## Test plan

There are no unit tests for these standalone server scripts today, and adding a
harness for a 58-line entry script is out of proportion (the repo's Vitest suite
covers `src/lib`/hooks/components, not `scripts/*` entry points). Verify by
exercising the running server instead:

1. Start the spawn server in the background:
   `bun scripts/spawn-terminal.ts &` — wait for the "Spawn server on
   <http://localhost:3002>" line.

2. **Rejected without the right origin** (simulates a malicious page / curl):

   ```
   curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3002/spawn
   ```

   → prints `403`. (Before this plan it would print `200` **and spawn a
   terminal** — if a terminal window opens here, Step 2 did not take effect;
   treat as a STOP condition.)

3. **Allowed with the dashboard origin** (simulates the real UI caller):

   ```
   curl -s -o /dev/null -w "%{http_code}" -X POST \
     -H 'Origin: http://localhost:5173' http://localhost:3002/spawn
   ```

   → prints `200` and a terminal window opens (that is the intended side effect).
   Close the spawned terminal.

4. **Loopback bind** (finding #2): confirm the server is not listening on all
   interfaces:

   ```
   lsof -nP -iTCP:3002 -sTCP:LISTEN | grep -q '127.0.0.1:3002' && echo LOOPBACK-OK
   ```

   → prints `LOOPBACK-OK`. If it instead shows `*:3002`, Step 1 did not take
   effect on the spawn server.

5. Stop the background server (`kill %1` or find the PID via the `lsof` output).

The `src/server.ts` loopback change is verified the same way against port 3001
if you start it (`bun run server`), but starting it is optional — the `tsc`
pass plus visual confirmation of the added `hostname` line is sufficient for that
one-line change.

## Done criteria

Machine-checkable. ALL must hold:

- [x] `bunx tsc --noEmit` exits 0
- [x] `bun run lint` exits 0 with no _new_ warnings (7 pre-existing are fine)
- [x] `bunx vitest run` → 133 passed (unchanged; this plan touches no tested code)
- [x] `grep -n "hostname: '127.0.0.1'" src/server.ts scripts/spawn-terminal.ts`
      returns two matches (one per file)
- [x] `grep -n "ALLOWED_ORIGIN" scripts/spawn-terminal.ts` returns at least two
      matches (declaration + use)
- [x] Manual Test-plan steps 2 and 3 print `403` then `200` respectively
- [x] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift since `4f0beea`).
- In Test-plan step 2 a terminal actually spawns despite a `403`, or the request
  is not rejected — the guard is not wired correctly and blindly retrying could
  leave the CSRF hole open.
- `Bun.serve` rejects the `hostname` option at runtime (would indicate a Bun
  version mismatch) — report the Bun version instead of guessing an alternative.
- The real UI caller (`TaskTable.tsx:1206`) appears to have gained custom headers
  or moved to same-origin — the origin-check assumption would need rechecking.

## Maintenance notes

- If the dashboard dev port ever changes from `5173`, `ALLOWED_ORIGIN` and the
  `cors` origin must both be updated — consider deriving one from the other in a
  follow-up.
- A reviewer should confirm the origin check sits **before** any `Bun.spawn`/side
  effect, not after, and that the rejection path returns before spawning.
- Deferred out of this plan: a per-session token or auth on `/api` (:3001). This
  plan only removes LAN reachability and CSRF-triggerability; it does not add
  authentication. Note it in `docs/IMPROVE.md`'s watch list if you want it tracked.
