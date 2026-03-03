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
