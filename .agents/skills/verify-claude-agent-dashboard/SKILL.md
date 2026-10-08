---
name: verify-claude-agent-dashboard
description: >-
  Drive the Claude Agent Dashboard web UI and Hono API locally for end-to-end
  verification. Use when you need proof that task polling, views, or hook-driven
  API behavior work after a change — not for unit-test-only edits already gated
  by CI.
---

# Verify Claude Agent Dashboard

Vite + React dashboard on **:5173** (proxies `/api/*` to Hono on **:3001**).
Two long-running processes — never double-drive ports the user may already have open.

## Launch

From repo root, with a disposable run id:

```bash
export VERIFY_RUN_ID="${VERIFY_RUN_ID:-$(date +%s)}"
.agents/skills/verify-claude-agent-dashboard/scripts/control-dashboard.sh launch
```

Ready when the script prints `ready` and both URLs respond. Logs:
`/tmp/claude-agent-dashboard-verify-$VERIFY_RUN_ID/{vite,hono}.log`.

Teardown (kills only the pids this run recorded):

```bash
.agents/skills/verify-claude-agent-dashboard/scripts/control-dashboard.sh stop
```

If ports 5173 or 3001 are already owned by another session, set `VERIFY_VITE_PORT`
and `VERIFY_HONO_PORT` to free ports before `launch`.

## Doctor

Run first whenever anything looks off:

```bash
.agents/skills/verify-claude-agent-dashboard/scripts/control-dashboard.sh doctor
```

Must print `doctor: OK`. A bare HTTP 200 is not enough — the script asserts page
title **Claude Agent Dashboard** and that `GET /api/tasks` returns a JSON array.

## Gate

Run these **before** launching an instance. They duplicate CI and the pre-commit
hook; do not re-prove them by hand in the browser.

| Tier               | Command                                  | Where                                |
| ------------------ | ---------------------------------------- | ------------------------------------ |
| Format (staged)    | `npx lint-staged`                        | `.husky/pre-commit`                  |
| Typecheck          | `bun run typecheck` (`tsc -b`)           | pre-commit, CI, `build`              |
| Lint               | `bun run lint` (oxlint, type-aware)      | pre-commit, CI                       |
| CSS lint           | `bun run lint:css`                       | CI only                              |
| Format check       | `bun run format:check`                   | CI only                              |
| Markdown lint      | `bun run lint:md`                        | CI (advisory, `continue-on-error`)   |
| Unit tests         | `bun run test:ci` (`vitest run`)         | pre-commit, CI                       |
| Build              | `bun run build` (`tsc -b && vite build`) | CI                                   |
| Changed-code audit | `fallow audit --base HEAD`               | pre-commit (when `fallow` installed) |

**Not in any gate today:** `src/server.ts` and `src/db/*` (excluded from
`tsconfig.app.json`). `tsc -b` checks 33 `src/` files; lifting the exclude adds
3 files with 0 observed errors (2026-08-29 snapshot in `.github/workflows/ci.yml`).

**Missing tier:** no GitHub branch-protection requirement is configured in-repo;
the workflow reports status but something must mark it required in GitHub settings.

## Drive

Browser harness hosts:

- **Cursor:** `cursor-ide-browser` MCP (`browser_navigate`, `browser_snapshot`, …)
- **Claude Code:** `mcp__chrome-devtools__*` equivalents

HTTP/curl is enough for API-only proofs; UI proofs need a browser.

1. `launch` → `doctor`.
2. Open `http://127.0.0.1:${VERIFY_VITE_PORT:-5173}/`.
3. Follow the feature file under `features/` that matches your change (see
   `features/README.md`). The map defines coverage — not whichever view happened
   to be on screen.

Stable handles from this repo:

| Surface           | Handle                                             |
| ----------------- | -------------------------------------------------- |
| Board view        | `aria-label="Board view"`                          |
| Table view        | `aria-label="Table view"`                          |
| Session events    | `aria-label` matching `/session events/i`          |
| Theme toggle      | `aria-label` matching `/Switch to (dark            | light) mode/i` |
| Tasks API (Hono)  | `GET http://127.0.0.1:3001/tasks` → JSON array     |
| Tasks API (proxy) | `GET http://127.0.0.1:5173/api/tasks` → JSON array |

Full hook-chain proof (optional): with the instance up, `bun run smoke` exercises
pre/post hooks against the live API — see `scripts/smoke-test.ts`.

## Evidence

Write artifacts under `/tmp/claude-agent-dashboard-proof-$VERIFY_RUN_ID/` (outside
the state dir so `stop` does not delete them).

Each proof needs:

1. **Action** — command or browser step actually run.
2. **Result** — response body snippet, ARIA snapshot, or screenshot.
3. **Assertion** — a string that must appear (not exit code alone). Example:
   `grep -q 'Board view' proof/snapshot.txt` after capturing the accessibility tree.

For API changes, capture `curl -s` output and assert on JSON fields. For UI
changes, capture `browser_take_screenshot` plus a snapshot listing the control you
used.

Do not mock `fetch` in the running app. Do not call internal test-only endpoints.

## Cleanup

```bash
.agents/skills/verify-claude-agent-dashboard/scripts/control-dashboard.sh stop
```

Confirm proof files still exist:

```bash
ls "/tmp/claude-agent-dashboard-proof-${VERIFY_RUN_ID}"
```

## Helpers

| Script                                                                      | Purpose                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `.agents/skills/verify-claude-agent-dashboard/scripts/control-dashboard.sh` | `launch` / `doctor` / `stop`                                    |
| `bun run smoke`                                                             | End-to-end hook → API → proxy chain (requires running instance) |

Keep `VERIFY_RUN_ID` stable across launch, drive, evidence, and cleanup in one session.
