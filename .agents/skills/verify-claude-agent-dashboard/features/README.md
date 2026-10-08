# Claude Agent Dashboard verification map

Read this index before driving the app. Each feature file is the recipe for one
user-visible area. A proof that exercises only the convenient entry point is
incomplete when the map lists others.

## Baseline preconditions

- Launch with `control-dashboard.sh launch` and a unique `VERIFY_RUN_ID`.
- Run `control-dashboard.sh doctor` — require `doctor: OK`.
- Default URLs: Vite `http://127.0.0.1:5173/`, Hono `http://127.0.0.1:3001/tasks`.
- Never drive ports 5173/3001 unless this run started them.

## Driving conventions

- Prefer `aria-label` and role queries from `browser_snapshot` output.
- Restore any data you mutate (delete smoke tasks, clear session events if added).
- API proofs use curl against `:3001`; UI proofs use the browser against `:5173`.

## Features

- [Task board and table views](./task-views.md) — Kanban board, table toggle, polling.
- [Session events strip](./session-events.md) — global lifecycle event panel.
- [Hook signal chain](./hook-api-chain.md) — pre/post hooks → REST → SQLite → UI.
