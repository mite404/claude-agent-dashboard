# Task board and table views

The main dashboard shows agent tasks from SQLite, polled every 2.5s. Users switch
between a Kanban board and a hierarchical table, toggle light/dark theme, and see
running/completed/failed counts in the header.

## Sub-features

- `views.board` — default Kanban columns by task status.
- `views.table` — expandable tree table with sort and filters.
- `views.theme` — light/dark toggle without flash.
- `views.polling` — tasks refresh without full page reload.

## How to get to it (user POV)

1. Open `http://127.0.0.1:5173/` (or `VERIFY_VITE_PORT`).
2. Default landing is **Board view** (column layout).
3. Click **Table view** (`aria-label="Table view"`) to switch layouts.
4. Click **Board view** (`aria-label="Board view"`) to switch back.
5. Click the theme control (`aria-label` matching `/Switch to (dark|light) mode/i`).

## Driving it with cursor-ide-browser

Preconditions: `control-dashboard.sh launch` and `doctor` OK. Seed tasks via
`bun run smoke` or POST `/api/tasks` if you need non-empty columns.

- **Board visible** — `browser_navigate` to `/`, `browser_snapshot`, assert snapshot
  contains `Board view` and at least one column heading or empty-state copy.
- **Table toggle** — `browser_click` the `Table view` button, snapshot must contain
  `Table view` pressed/selected and table semantics (`row` or `Filter tasks`).
- **Theme** — click theme toggle, snapshot `aria-label` flips between dark/light.

## Gotchas

- Empty DB shows empty columns — that is valid; assert structure, not task count.
- Polling is async — wait one refresh interval (2.5s) before asserting new tasks.
- Do not use `bun run dev` for verification; it also tails hook logs and spawns a
  terminal, and collides with the user's normal dev session.
