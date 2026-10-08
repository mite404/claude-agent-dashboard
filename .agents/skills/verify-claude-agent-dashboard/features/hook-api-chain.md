# Hook signal chain

Claude Code hooks POST/PATCH tasks and session events to the Hono API; the React
app polls and renders them. This is the production path — not in-memory mocks.

## Sub-features

- `chain.pre` — `pre-tool-agent` creates a running task.
- `chain.post` — `post-tool-agent` completes the task and appends logs.
- `chain.proxy` — Vite proxies `/api/tasks` to Hono for the browser.

## How to get to it (user POV)

Hooks run inside Claude Code; for verification, the smoke script simulates them:

```bash
bun run smoke
```

(Requires the Hono server on :3001 — full `launch` satisfies this.)

## Driving it with curl and smoke

Preconditions: `control-dashboard.sh launch` + `doctor` OK.

1. `bun run smoke` — stdout must include passing checks for API, proxy, pre-hook,
   post-hook, and cleanup.
2. During the run, `curl -s http://127.0.0.1:3001/api/tasks | grep smoke-test`
   must match while the task exists.
3. After cleanup, that grep must return nothing (`grep -q` failure is success).

## Gotchas

- `smoke` shells out to hook scripts with a synthetic payload — it proves the
  API and scripts, not that Claude Code settings are wired on the host machine.
- Do not run smoke against a production database you care about; use the default
  local SQLite file or a copied DB.
