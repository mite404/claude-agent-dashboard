# FOR_ETHAN.md — Claude Agent Dashboard

> A living learning log. Updated as the project grows.

---

## 1. The Story So Far

We built a real-time web dashboard to watch Claude Code's subagents run in parallel — think of it like a director's monitor on a film set, except instead of watching cameras, you're watching AI agents execute tasks simultaneously.

The problem it solves: when Claude spawns multiple background agents (one writing tests, one building UI, one auditing security), you had zero visibility into what they were doing. This dashboard changes that by polling a local data file every 2.5 seconds and rendering status, progress, logs, and hierarchy in a browser UI.

**Current status**: The UI is built and running with mock data. The Vite → json-server pipeline is wired. A Claude Code hook needs to be connected to feed real task data.

---

## 2. Cast & Crew (Architecture)

Think of this like a live broadcast pipeline:

```
Claude Code (the talent)
    → PostToolUse Hook (the stage manager, cues between acts)
        → db.json (the script — the shared source of truth)
            → json-server (the teleprompter server — REST API on port 3001)
                → Vite dev server (the broadcast truck — proxies /api/* to json-server)
                    → React UI polling every 2.5s (the control room monitor)
```

**Key cast members:**

| File | Role |
|------|------|
| `db.json` | Source of truth. json-server reads + writes here. |
| `src/hooks/useTaskPolling.ts` | The heartbeat. Fetches `/api/tasks` on a timer. |
| `src/components/Dashboard.tsx` | The control room. Holds state, renders everything. |
| `src/components/TaskTree.tsx` | The org chart. Renders parent → child recursively. |
| `src/components/TaskCard.tsx` | The monitor tile. One task per card. |
| `src/components/LogViewer.tsx` | The tape deck. Accordion log viewer. |
| `src/components/ControlButtons.tsx` | The intercom. Cancel/Pause/Retry via PATCH. |
| `vite.config.ts` | The broadcast director. Routes, proxies, and watching rules. |

---

## 3. Behind the Scenes (Decisions)

### Why Vite instead of Bun's built-in bundler?

Bun has its own bundler (`bun build`) that can serve HTML files directly — no Vite needed. But Vite was chosen here because:

- It has a mature ecosystem of plugins (like `vite-tsconfig-paths`, `@tailwindcss/vite`)
- The HMR (Hot Module Replacement) is fast and well-tested with React
- The proxy configuration (`/api` → json-server) is built in and clean

Trade-off: one more process, one more dependency. Worth it for DX.

### Why json-server instead of a custom Bun server?

json-server turns a `db.json` file into a full REST API automatically:

- `GET /tasks` → list all
- `PATCH /tasks/:id` → partial update (what Cancel/Pause/Retry use)

This means zero server code. The Cancel button PATCHes `{ status: 'cancelled' }` directly to json-server, which writes it to `db.json`. The dashboard's polling loop picks it up 2.5 seconds later.

If we'd written a custom Bun server, we'd need to handle routing, persistence, and serialization ourselves. Not worth it for this use case.

### Why Tailwind v4 instead of v3?

Tailwind v4 (released early 2025) flipped the config model:

| v3 | v4 |
|----|----|
| `tailwind.config.js` (JavaScript) | `@theme {}` block in CSS |
| `postcss.config.js` required | PostCSS **not needed** |
| `content: ['./src/**/*.tsx']` | Automatically scans files |
| `theme.extend.colors` | CSS custom properties in `@theme` |

In `src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-status-running: hsl(217 91% 60%);
}
```

That `--color-status-running` token is now usable as `text-status-running` in any component automatically — no config, no rebuild.

### Why `vite-tsconfig-paths` instead of duplicating aliases?

Without it, you'd need to define `@` → `./src` in **two places**:

1. `tsconfig.app.json` → `"paths": { "@/*": ["./src/*"] }` (for TypeScript)
2. `vite.config.ts` → `resolve.alias` (for the bundler)

`vite-tsconfig-paths` reads your tsconfig and gives that info to Vite automatically. Single source of truth.

### Why polling instead of WebSockets?

WebSockets are real-time but add complexity: you need the server to push events, manage connections, handle disconnects. For a personal dev tool that checks in every 2.5 seconds, polling is simpler and "imperceptibly different" from the user's perspective. Senior engineers call this **choosing boring technology** — pick the least complex solution that meets the requirements.

---

## 4. Bloopers (Bugs & Fixes)

### 🎬 Blooper 1: Wrong package version

**What happened:** `@radix-ui/react-slot@^2.0.2` was specified in `package.json`, but that version doesn't exist. bun install errored out.

**Why it happened:** The version was written from memory/assumptions rather than verified against the actual registry.

**Fix:** Run `bun info <package>` first to check what versions exist before pinning one. The actual latest was `1.2.4`.

**Lesson:** Always verify package versions with `bun info <package>` before adding them to `package.json`. Ranges like `^1.0.0` are safer than exact guesses.

---

### 🎬 Blooper 2: Page flashing white on button click

**What happened:** Clicking Cancel/Pause/Retry caused the entire app to flash white and reload.

**Why it happened:** Vite watches all files in the project directory for changes. When the Cancel button PATCHed json-server, json-server rewrote `db.json`. Vite saw `db.json` change and triggered a full page reload — like a director yelling "cut!" every time a prop was moved on set.

**Fix:** Tell Vite to ignore `db.json` in its file watcher:

```typescript
server: {
  watch: {
    ignored: ['**/db.json'],
  },
}
```

**Lesson:** Vite's HMR system watches ALL project files by default, not just source files. When you have data files that get written by external processes (like json-server), you need to explicitly exclude them.

---

### 🎬 Blooper 3: `@` alias imports failing silently

**What happened:** Vite couldn't resolve `@/hooks/useTaskPolling` even though the file existed at `src/hooks/useTaskPolling.ts`.

**Why it happened:** Two failed attempts:

1. First try used `path.resolve(__dirname, './src')` — `__dirname` doesn't exist in ESM modules (files with `"type": "module"` in `package.json`). Vite does shim it in config files, but the alias value ended up wrong.
2. Second try used `fileURLToPath(new URL('./src', import.meta.url))` — correct approach for ESM, but Vite still didn't pick it up in time because a full server restart is required for config changes (HMR doesn't apply to the config file itself).

**Fix:** Use `vite-tsconfig-paths` plugin. It reads path mappings from `tsconfig.app.json` and hands them to Vite — one source of truth, no manual alias wiring.

**Lesson:** Config file changes in Vite **always require a full restart** (`Ctrl+C` + `bun run dev`). HMR only applies to source files, not the bundler config.

---

### 🎬 Blooper 4: Unused React imports causing TS errors

**What happened:** `import * as React from 'react'` in `badge.tsx` and `progress.tsx` triggered TypeScript error `TS6133: 'React' is declared but its value is never read`.

**Why it happened:** React 17 introduced the "new JSX transform" — you no longer need to `import React` for JSX to work. The compiler handles that automatically. Importing it anyway creates an unused variable.

**Fix:** Remove the import. The `tsx` files using JSX work fine without it since we set `"jsx": "react-jsx"` in `tsconfig.app.json`.

**Lesson:** If your tsconfig has `"jsx": "react-jsx"` (not `"react"`), you don't need to import React in every file. The old pattern (`import React from 'react'`) is a pre-2021 habit.

---

### 🎬 Blooper 5: Prop name mismatch

**What happened:** `Dashboard.tsx` passed a `tree` prop to `TaskTree`, but the component defined the prop as `nodes`. TypeScript caught it with `TS2322`.

**Why it happened:** The component interface and the call site were written in separate passes and the name wasn't kept consistent.

**Fix:** Change `<TaskTree tree={tree}` to `<TaskTree nodes={tree}` in Dashboard.

**Lesson:** TypeScript's value here is exactly this — it catches mismatches between what a component expects and what the caller provides, before you ever open the browser. Treat TS errors as a test suite that runs for free.

---

## 4b. Bloopers — Card-to-Table Refactor (2026-03-03)

### 🎬 Blooper 6: You can't just sort a flat list when your data is a tree

**The situation:** The first instinct when adding "sort by status" was: grab all the tasks, sort the array by status, render them. Done, right?

**Why that breaks:** Our tasks have parent/child relationships. If you sort a flat list, a child task ("Build CI pipeline") could end up rendered *above* its parent ("Orchestrate workflow"). The tree hierarchy falls apart — orphaned rows floating in the wrong order.

**The fix:** Sort *recursively*. Sort the top-level parent nodes relative to each other, then for each parent, sort *its children* relative to each other. The family units stay intact.

```typescript
function sortNodes(nodes: TaskNode[], dir: SortDir): TaskNode[] {
  if (!dir) return nodes
  const sorted = [...nodes].sort((a, b) => {
    const cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted.map(n => ({ ...n, children: sortNodes(n.children, dir) }))
}
```

**Film analogy:** It's like sorting a shoot schedule by scene type. You can reorder the *days* of production, but you can't separate a director from their crew within a given day. The hierarchy is the atomic unit.

**Lesson:** When your data is a tree, any sorting or filtering must be recursive. An operation that flattens the tree first and then acts on the flat list will always break parent/child groupings.

---

### 🎬 Blooper 7: The card "owned" its own controls — the table can't work that way

**The old architecture:** Each `TaskCard` contained `ControlButtons`, which contained its own `fetch` call to PATCH json-server. The card was a self-contained unit — it knew how to cancel itself, pause itself, retry itself. This is called a **fat component**: it owns both rendering *and* actions.

**Why that pattern breaks in a table:** In a table, each row is a thin data renderer. If Cancel/Retry lived inside each row with their own `fetch` logic and `busy` state, you'd have dozens of independent state machines — and no single place to coordinate "which row is currently doing something."

**The fix:** Lift the action logic up to the parent. `TaskTable` owns a single `handleAction` function and a single `busy: Record<string, string>` tracker. Each row receives an `onAction` callback prop. The row calls `onAction('cancel')` — it has no idea what that actually does.

```
TaskTable         ← owns: busy, expandedRows, selectedRows, filters, sort
  └── TaskRow     ← calls: onAction, onToggleExpand, onToggleLogs (thin)
```

**Film analogy:** The old card system was like every actor booking their own car. The table system has one production coordinator who handles all logistics. The actors just say "I need a ride."

**Lesson:** Fat components are fine for isolated widgets. But once components need to *share* state or *coordinate*, lift that state to the nearest common ancestor. This is one of React's core patterns: "lifting state up."

---

### 🎬 Blooper 8: You can't put a `key` prop on a `<>` fragment shorthand

**The situation:** The table needed to render *two sibling `<tr>` elements* per task — the task row, and an optional log detail row directly below it. In a `.map()`, React requires a `key` on the outermost element of each item so it can track list order efficiently.

**The problem:** `<>...</>` is shorthand for `React.Fragment`, but **`<>` does not accept any props — including `key`**. This silently fails or errors:

```tsx
tasks.map(({ task }) => (
  <>  {/* ← can't put key here */}
    <TaskRow ... />
    {logsOpen && <LogDetailRow ... />}
  </>
))
```

**The fix:** Use the explicit long form `<React.Fragment key={task.id}>`. This is identical at runtime but accepts `key`:

```tsx
tasks.map(({ task }) => (
  <React.Fragment key={task.id}>
    <TaskRow ... />
    {expandedLogs.has(task.id) && <LogDetailRow ... />}
  </React.Fragment>
))
```

React now treats the pair (task row + log row) as one keyed unit. When the log row appears or disappears, React reconciles it correctly against the right task.

**Lesson:** `<>` is syntax sugar — convenient, but it strips away the ability to pass props. Whenever you need `key` on a fragment (which happens in any `.map()` that renders sibling element groups), switch to `<React.Fragment key={...}>`.

---

### 🎬 Blooper 9: The checkbox "indeterminate" state doesn't exist as a React prop

**The situation:** The "select all" checkbox in the table header needs three states: unchecked (nothing selected), checked (everything selected), and *indeterminate* (some selected — the ⊟ half-filled visual). That third state is how every professional data table signals partial selection.

**The problem:** HTML checkboxes have an `indeterminate` property — but it's a **DOM property**, not an HTML attribute. React's model is built on attributes (things you set in JSX). To set a DOM property imperatively, you'd need a `useRef` + `useEffect`:

```tsx
// The ugly raw HTML way
const ref = useRef<HTMLInputElement>(null)
useEffect(() => { if (ref.current) ref.current.indeterminate = someSelected }, [someSelected])
<input type="checkbox" ref={ref} ... />
```

**The fix:** Radix UI's `<Checkbox>` accepts `checked="indeterminate"` as a special value and handles the DOM property internally. One clean prop, no refs.

```tsx
const headerChecked = allSelected ? true : someSelected ? 'indeterminate' : false
<Checkbox checked={headerChecked} onChange={toggleAll} />
```

**Lesson:** Some browser behaviors don't map cleanly to React's prop model because they're DOM *properties* (set via JavaScript), not HTML *attributes* (set via markup). Radix UI exists partly to paper over exactly these gaps — it wraps the imperative DOM API in a declarative React interface.

---

### 🎬 Blooper 10: Auto-expanding new task rows without clobbering the user's manual state

**The situation:** When the table first loads, parent tasks should be expanded by default so you can see their children. But the tree updates every 2.5 seconds from polling. If you reset `expandedRows` on every poll, any row the user manually collapsed would instantly snap back open — the UI fighting the user.

**The wrong fix:**

```tsx
// ❌ This resets ALL expanded state on every poll
useEffect(() => {
  const parentIds = new Set(tree.filter(n => n.children.length > 0).map(n => n.id))
  setExpandedRows(parentIds) // blows away manual collapses
}, [tree])
```

**The right fix:** Only *add* newly-seen parent IDs — never remove ones already tracked. The `Set` grows monotonically from polling, but only *shrinks* when the user manually clicks a collapse toggle.

```tsx
useEffect(() => {
  setExpandedRows(prev => {
    const next = new Set(prev)           // start from existing state
    const collect = (nodes: TaskNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) next.add(n.id)  // only add, never remove
        collect(n.children)
      }
    }
    collect(tree)
    return next
  })
}, [tree])
```

**Film analogy:** Think of `expandedRows` like a director's shot list. New shots get appended as production evolves — you never throw away the whole list just because a new day of shooting started.

**Lesson:** When polling data updates state that users also control manually, always *merge* incoming data into existing user state rather than replacing it. Replacing feels like the app is fighting the user. The rule of thumb: polling can only *add* to user-driven state, never *reset* it.

---

## 5. Director's Commentary

### On "boring technology"

The architecture of this project deliberately avoids exciting choices: no WebSockets, no Redux, no GraphQL, no edge functions. Each of those would solve a real problem — but not a problem *this* project actually has. Senior engineers have a bias toward solutions that are simple enough to be understood at 2am when something breaks.

Ask yourself before adding complexity: "Does this project *actually need* this, or does it just feel more impressive?"

### On the `@/` path alias pattern

The `@/` prefix for imports (e.g., `@/components/Button`) is a convention that means "root of the src directory." It prevents deeply-nested relative imports like `../../../components/Button`. You'll see this in nearly every React/Vue/Next.js project. The machinery behind it:

1. TypeScript uses `tsconfig paths` to understand it for type-checking
2. The bundler (Vite) uses an alias or plugin to resolve it at build time

They must agree. `vite-tsconfig-paths` makes them agree automatically.

### On json-server as a prototyping tool

json-server is one of those tools that looks like a toy but saves hours of work. It's a REST API from a flat JSON file — reads, writes, filters, pagination, all included. For any project where you need a backend for prototyping but don't want to write one, reach for json-server first.

When you outgrow it (auth, complex queries, relations), you swap it for a real backend. The frontend code doesn't change because the API contract (REST over HTTP) stays the same.

### On file-based state vs database

`db.json` is essentially a file-based database. This works for a single-user local tool but would break down with concurrent writes (two processes writing simultaneously would corrupt the file) or large datasets (reading 10MB of JSON on every poll is slow). For this project, it's perfect. For a production system serving multiple users, you'd want SQLite at minimum.
