# FOR_ETHAN.md — Claude Agent Dashboard

> A living learning log. Updated as the project grows.

---

## 1. The Story So Far

We built a real-time web dashboard to watch Claude Code's subagents run in parallel — think of it
like a director's monitor on a film set, except instead of watching cameras, you're watching AI
agents execute tasks simultaneously.

The problem it solves: when Claude spawns multiple background agents (one writing tests, one
building UI, one auditing security), you had zero visibility into what they were doing. This
dashboard changes that by polling a local data file every 2.5 seconds and rendering status,
progress, logs, and hierarchy in a browser UI.

**Current status**: The UI is built and running with mock data. The Vite → json-server pipeline is
wired. A Claude Code hook needs to be connected to feed real task data.

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

Bun has its own bundler (`bun build`) that can serve HTML files directly — no Vite needed. But
Vite
was chosen here because:

- It has a mature ecosystem of plugins (like `vite-tsconfig-paths`, `@tailwindcss/vite`)
- The HMR (Hot Module Replacement) is fast and well-tested with React
- The proxy configuration (`/api` → json-server) is built in and clean

Trade-off: one more process, one more dependency. Worth it for DX.

### Why json-server instead of a custom Bun server?

json-server turns a `db.json` file into a full REST API automatically:

- `GET /tasks` → list all
- `PATCH /tasks/:id` → partial update (what Cancel/Pause/Retry use)

This means zero server code. The Cancel button PATCHes `{ status: 'cancelled' }` directly to
json-server, which writes it to `db.json`. The dashboard's polling loop picks it up 2.5 seconds
later.

If we'd written a custom Bun server, we'd need to handle routing, persistence, and serialization
ourselves. Not worth it for this use case.

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

That `--color-status-running` token is now usable as `text-status-running` in any component
automatically — no config, no rebuild.

### Why `vite-tsconfig-paths` instead of duplicating aliases?

Without it, you'd need to define `@` → `./src` in **two places**:

1. `tsconfig.app.json` → `"paths": { "@/*": ["./src/*"] }` (for TypeScript)
2. `vite.config.ts` → `resolve.alias` (for the bundler)

`vite-tsconfig-paths` reads your tsconfig and gives that info to Vite automatically. Single source
of truth.

### Why polling instead of WebSockets?

WebSockets are real-time but add complexity: you need the server to push events, manage connections,
handle disconnects. For a personal dev tool that checks in every 2.5 seconds, polling is simpler and
"imperceptibly different" from the user's perspective. Senior engineers call this **choosing boring
technology** — pick the least complex solution that meets the requirements.

---

## 4. Bloopers (Bugs & Fixes)

### 🎬 Blooper 1: Wrong package version

**What happened:** `@radix-ui/react-slot@^2.0.2` was specified in `package.json`, but that version
doesn't exist. bun install errored out.

**Why it happened:** The version was written from memory/assumptions rather than verified against
the actual registry.

**Fix:** Run `bun info <package>` first to check what versions exist before pinning one. The actual
latest was `1.2.4`.

**Lesson:** Always verify package versions with `bun info <package>` before adding them to
`package.json`. Ranges like `^1.0.0` are safer than exact guesses.

---

### 🎬 Blooper 2: Page flashing white on button click

**What happened:** Clicking Cancel/Pause/Retry caused the entire app to flash white and reload.

**Why it happened:** Vite watches all files in the project directory for changes. When the Cancel
button PATCHed json-server, json-server rewrote `db.json`. Vite saw `db.json` change and triggered a
full page reload — like a director yelling "cut!" every time a prop was moved on set.

**Fix:** Tell Vite to ignore `db.json` in its file watcher:

```typescript
server: {
  watch: {
    ignored: ['**/db.json'],
  },
}
```

**Lesson:** Vite's HMR system watches ALL project files by default, not just source files. When you
have data files that get written by external processes (like json-server), you need to explicitly
exclude them.

---

### 🎬 Blooper 3: `@` alias imports failing silently

**What happened:** Vite couldn't resolve `@/hooks/useTaskPolling` even though the file existed at
`src/hooks/useTaskPolling.ts`.

**Why it happened:** Two failed attempts:

1. First try used `path.resolve(__dirname, './src')` — `__dirname` doesn't exist in ESM modules
2. (files with `"type": "module"` in `package.json`). Vite does shim it in config files,
   but the alias value ended up wrong.
3. Second try used `fileURLToPath(new URL('./src', import.meta.url))` — correct approach for ESM,
but Vite still didn't pick it up in time because a full server restart is required for config
changes (HMR doesn't apply to the config file itself).

**Fix:** Use `vite-tsconfig-paths` plugin. It reads path mappings from `tsconfig.app.json` and hands
them to Vite — one source of truth, no manual alias wiring.

**Lesson:** Config file changes in Vite **always require a full restart** (`Ctrl+C` + `bun run
dev`). HMR only applies to source files, not the bundler config.

---

### 🎬 Blooper 4: Unused React imports causing TS errors

**What happened:** `import * as React from 'react'` in `badge.tsx` and `progress.tsx` triggered
TypeScript error `TS6133: 'React' is declared but its value is never read`.

**Why it happened:** React 17 introduced the "new JSX transform" — you no longer need to `import
React` for JSX to work. The compiler handles that automatically. Importing it anyway creates an
unused variable.

**Fix:** Remove the import. The `tsx` files using JSX work fine without it since we set `"jsx":
"react-jsx"` in `tsconfig.app.json`.

**Lesson:** If your tsconfig has `"jsx": "react-jsx"` (not `"react"`), you don't need to import
React in every file. The old pattern (`import React from 'react'`) is a pre-2021 habit.

---

### 🎬 Blooper 5: Prop name mismatch

**What happened:** `Dashboard.tsx` passed a `tree` prop to `TaskTree`, but the component defined the
prop as `nodes`. TypeScript caught it with `TS2322`.

**Why it happened:** The component interface and the call site were written in separate passes and
the name wasn't kept consistent.

**Fix:** Change `<TaskTree tree={tree}` to `<TaskTree nodes={tree}` in Dashboard.

**Lesson:** TypeScript's value here is exactly this — it catches mismatches between what a
component
expects and what the caller provides, before you ever open the browser. Treat TS errors as a test
suite that runs for free.

---

## 4b. Bloopers — Card-to-Table Refactor (2026-03-03)

### 🎬 Blooper 6: You can't just sort a flat list when your data is a tree

**The situation:** The first instinct when adding "sort by status" was: grab all the tasks, sort the
array by status, render them. Done, right?

**Why that breaks:** Our tasks have parent/child relationships. If you sort a flat list, a child
task ("Build CI pipeline") could end up rendered *above* its parent ("Orchestrate workflow"). The
tree hierarchy falls apart — orphaned rows floating in the wrong order.

**The fix:** Sort *recursively*. Sort the top-level parent nodes relative to each other, then for
each parent, sort *its children* relative to each other. The family units stay intact.

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

**Film analogy:** It's like sorting a shoot schedule by scene type. You can reorder the *days* of
production, but you can't separate a director from their crew within a given day. The hierarchy is
the atomic unit.

**Lesson:** When your data is a tree, any sorting or filtering must be recursive. An operation that
flattens the tree first and then acts on the flat list will always break parent/child groupings.

---

### 🎬 Blooper 7: The card "owned" its own controls — the table can't work that way

**The old architecture:** Each `TaskCard` contained `ControlButtons`, which contained its own
`fetch` call to PATCH json-server. The card was a self-contained unit — it knew how to cancel
itself, pause itself, retry itself. This is called a **fat component**: it owns both rendering *and*
actions.

**Why that pattern breaks in a table:** In a table, each row is a thin data renderer. If
Cancel/Retry lived inside each row with their own `fetch` logic and `busy` state, you'd have dozens
of independent state machines — and no single place to coordinate "which row is currently doing
something."

**The fix:** Lift the action logic up to the parent. `TaskTable` owns a single `handleAction`
function and a single `busy: Record<string, string>` tracker. Each row receives an `onAction`
callback prop. The row calls `onAction('cancel')` — it has no idea what that actually does.

```
TaskTable         ← owns: busy, expandedRows, selectedRows, filters, sort
  └── TaskRow     ← calls: onAction, onToggleExpand, onToggleLogs (thin)
```

**Film analogy:** The old card system was like every actor booking their own car. The table system
has one production coordinator who handles all logistics. The actors just say "I need a ride."

**Lesson:** Fat components are fine for isolated widgets. But once components need to *share* state
or *coordinate*, lift that state to the nearest common ancestor. This is one of React's core
patterns: "lifting state up."

---

### 🎬 Blooper 8: You can't put a `key` prop on a `<>` fragment shorthand

**The situation:** The table needed to render *two sibling `<tr>` elements* per task — the task
row,
and an optional log detail row directly below it. In a `.map()`, React requires a `key` on the
outermost element of each item so it can track list order efficiently.

**The problem:** `<>...</>` is shorthand for `React.Fragment`, but **`<>` does not accept any props
— including `key`**. This silently fails or errors:

```tsx
tasks.map(({ task }) => (
  <>  {/* ← can't put key here */}
    <TaskRow ... />
    {logsOpen && <LogDetailRow ... />}
  </>
))
```

**The fix:** Use the explicit long form `<React.Fragment key={task.id}>`. This is identical at
runtime but accepts `key`:

```tsx
tasks.map(({ task }) => (
  <React.Fragment key={task.id}>
    <TaskRow ... />
    {expandedLogs.has(task.id) && <LogDetailRow ... />}
  </React.Fragment>
))
```

React now treats the pair (task row + log row) as one keyed unit. When the log row appears or
disappears, React reconciles it correctly against the right task.

**Lesson:** `<>` is syntax sugar — convenient, but it strips away the ability to pass props.
Whenever you need `key` on a fragment (which happens in any `.map()` that renders sibling element
groups), switch to `<React.Fragment key={...}>`.

---

### 🎬 Blooper 9: The checkbox "indeterminate" state doesn't exist as a React prop

**The situation:** The "select all" checkbox in the table header needs three states: unchecked
(nothing selected), checked (everything selected), and *indeterminate* (some selected — the ⊟
half-filled visual). That third state is how every professional data table signals partial
selection.

**The problem:** HTML checkboxes have an `indeterminate` property — but it's a **DOM property**,
not
an HTML attribute. React's model is built on attributes (things you set in JSX). To set a DOM
property imperatively, you'd need a `useRef` + `useEffect`:

```tsx
// The ugly raw HTML way
const ref = useRef<HTMLInputElement>(null)
useEffect(() => { if (ref.current) ref.current.indeterminate = someSelected }, [someSelected])
<input type="checkbox" ref={ref} ... />
```

**The fix:** Radix UI's `<Checkbox>` accepts `checked="indeterminate"` as a special value and
handles the DOM property internally. One clean prop, no refs.

```tsx
const headerChecked = allSelected ? true : someSelected ? 'indeterminate' : false
<Checkbox checked={headerChecked} onChange={toggleAll} />
```

**Lesson:** Some browser behaviors don't map cleanly to React's prop model because they're DOM
*properties* (set via JavaScript), not HTML *attributes* (set via markup). Radix UI exists partly to
paper over exactly these gaps — it wraps the imperative DOM API in a declarative React interface.

---

### 🎬 Blooper 10: Auto-expanding new task rows without clobbering the user's manual state

**The situation:** When the table first loads, parent tasks should be expanded by default so you can
see their children. But the tree updates every 2.5 seconds from polling. If you reset `expandedRows`
on every poll, any row the user manually collapsed would instantly snap back open — the UI
fighting
the user.

**The wrong fix:**

```tsx
// ❌ This resets ALL expanded state on every poll
useEffect(() => {
  const parentIds = new Set(tree.filter(n => n.children.length > 0).map(n => n.id))
  setExpandedRows(parentIds) // blows away manual collapses
}, [tree])
```

**The right fix:** Only *add* newly-seen parent IDs — never remove ones already tracked. The `Set`
grows monotonically from polling, but only *shrinks* when the user manually clicks a collapse
toggle.

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

**Film analogy:** Think of `expandedRows` like a director's shot list. New shots get appended as
production evolves — you never throw away the whole list just because a new day of shooting
started.

**Lesson:** When polling data updates state that users also control manually, always *merge*
incoming data into existing user state rather than replacing it. Replacing feels like the app is
fighting the user. The rule of thumb: polling can only *add* to user-driven state, never *reset* it.

---

### 🎬 Blooper 11: Recursive types and renaming — the refactoring that breaks everything

**The situation:** PR-4 refactored the sort state from `dir: SortDir` (a primitive) to a full
`SortState` object with `{ col: SortCol | null; dir: "asc" | "desc" }`. This required updating
multiple call sites. The refactoring started fine, but some references were missed.

**The pattern that broke:**

```typescript
// OLD pattern: sortDir was a primitive
const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
const sorted = sortNodes(tree, sortDir);  // ← pass primitive

// NEW pattern: sort is an object
const [sort, setSort] = useState<SortState>({ col: null, dir: "asc" });
const sorted = sortNodes(tree, sort);  // ← pass object
```

But when the refactoring wasn't complete, the code mixed old and new:

```typescript
const [sort, setSort] = useState<SortState>({ ... });  // ← new variable name
const sorted = sortNodes(tree, sortDir);  // ← old variable name (doesn't exist!)
```

Result: **blank page** — the code tries to use `sortDir` which is undefined.

**Why this happened:**

Variable renames are slippery because they're not caught until runtime (unless TypeScript strict
mode is on everywhere). The developer renamed the state variable but didn't update all 6 call sites
(`useMemo` dependency array, sort function parameter, rendering logic, `cycleSort` handler, etc.).
The app ran fine until it tried to access an undefined variable.

**Why recursive types matter here:**

The `sortNodes` function is **recursive** — it calls itself on the tree's children:

```typescript
function sortNodes(nodes: TaskNode[], sort: SortState): TaskNode[] {
  // ... sort logic ...
  return sorted.map((n) => ({
    ...n,
    children: sortNodes(n.children, sort)  // ← calls itself with same 'sort' object
  }));
}
```

The `sort` parameter gets passed down through every level of the tree. If you rename it at the top
level, you must rename it everywhere it's used — including the recursive calls.

**What's a recursive type?**

A recursive type refers to itself. `TaskNode` is self-referential:

```typescript
interface Task {
  id: string;
  name: string;
  // ...
}

interface TaskNode extends Task {
  children: TaskNode[]  // ← TaskNode contains TaskNode[], which can contain TaskNode[]
}
```

This creates an infinitely nestable tree structure — each node can contain nodes of the same type.
It's like Russian dolls: a doll (TaskNode) can contain smaller dolls (TaskNode[]).

**The refactoring lesson:**

When you rename a variable that flows through a recursive function:

1. Update the `useState` declaration
2. Update all `useMemo` / `useCallback` dependency arrays
3. Update all call sites (where the function is invoked)
4. Update all references **inside** the function (including recursive calls)
5. Update UI code that reads the variable

A search for the old name should return zero results. If it doesn't, you missed a spot.

**The pattern to understand:**

Recursion works by **passing the same parameter down** through each level:

```typescript
function processTree(nodes: TaskNode[], config: SortState) {
  // Process this level...
  return nodes.map(n => ({
    ...n,
    // Process the next level with the SAME config
    children: processTree(n.children, config)
  }));
}
```

Each recursive call gets the same `config`. This is why `config` was renamed from `sortDir` to
`sort` everywhere — the parameter name must be consistent or the function breaks.

---

## Phase 5: The Hook System — Making It Live (2026-03-04)

### The Big Idea

Up to now the dashboard ran on mock data. Phase 5 connects it to the actual Claude Code agent system
by wiring two shell scripts as "hooks" — callbacks that fire automatically when the Agent tool is
used.

The analogy: hooks are like **production assistants on a film set**. One assistant (pre-hook) slates
the camera the moment a take begins. Another (post-hook) logs the take result when it's done. The
dashboard is the director watching the monitors.

### The Signal Chain (Updated)

```
Claude Code fires Agent tool call
  → PreToolUse hook → scripts/pre-tool-agent.sh reads stdin
      → upserts task { status: "running", progress: 0 } into db.json

  → Agent executes (could be seconds or minutes)

  → PostToolUse hook → scripts/post-tool-agent.sh reads stdin (includes tool result)
      → updates task { status: "completed" | "failed", progress: 100 } in db.json

Dashboard polls /api/tasks every 2.5s → React table updates
```

The key insight: **`tool_use_id` is the stable link.** Both hooks receive the same `tool_use_id` for
a given Agent invocation. The pre-hook creates the task record with that ID; the post-hook finds it
by that same ID and updates it.

### What "stdin" Means for Hooks

When Claude Code fires a hook, it writes a JSON object to the script's `stdin` (standard input —
the
pipe that programs read from when you don't give them a file). The script reads it with
`INPUT=$(cat)` and parses it with `jq`.

For PreToolUse (Agent starting):

```json
{
  "tool_use_id": "toolu_01abc...",
  "tool_input": {
    "description": "Review the authentication PR",
    "subagent_type": "pr-review-toolkit:code-reviewer",
    "run_in_background": false
  }
}
```

For PostToolUse (Agent done):

```json
{
  "tool_use_id": "toolu_01abc...",
  "tool_input": { "...same as above..." },
  "tool_response": {
    "content": [{ "type": "text", "text": "Found 3 issues..." }],
    "is_error": false
  }
}
```

### Background Tasks: The Special Case

When you invoke an Agent with `run_in_background: true`, Claude Code dispatches it to run async and
returns immediately. The PostToolUse hook fires when the *dispatch* completes — not when the
actual
agent work finishes. So:

- Pre-hook creates task as `running`
- Post-hook sees `run_in_background: true` and **does not** mark it `completed`
- The task stays `running` indefinitely (until Phase 7 adds completion tracking)

This is a known limitation. The workaround: background tasks that you care about tracking should be
foreground tasks for now.

### Atomic Writes — Avoiding Race Conditions

The scripts never write directly to `db.json`. Instead:

```bash
jq '...' db.json > db.json.tmp && mv db.json.tmp db.json
```

Why? `jq` reads from `db.json` and needs to finish processing before anything else reads it. If you
wrote directly (`jq '...' db.json > db.json`), the shell would truncate `db.json` to zero bytes
*before* `jq` had read it — corrupting your data. Writing to a `.tmp` file first, then atomically
renaming it, avoids this entirely.

Think of it as the "safe cut" technique in editing: you export to a new file, verify it's good, then
replace the original. You never destructively overwrite the original in place.

### Why Bash, Not TypeScript?

The existing project scripts (`fix-tailwind-vars.ts`, `spawn-terminal.ts`) are TypeScript files run
with `bun`. But hooks are different — they need to run in any shell environment, and the hook
runner
may not have `bun` in `$PATH`. A bash script with `jq` is universally available on macOS. Fewer
dependencies = fewer failure modes at the system boundary.

### Settings Location: Global vs Project

The hooks are wired in `~/.claude/settings.json` (your home directory), not in the project's
`.claude/settings.json`. This matters because:

- **Project-level** hooks only fire when you're working in *that specific project*
- **Global** hooks fire across all your Claude Code sessions, regardless of which project you're in

Since the dashboard is meant to monitor all your agent sessions (not just sessions inside the
dashboard repo), global is the right call.

---

## 4c. Bloopers — Hook System & Terminal Integration (2026-03-04)

### 🎬 Blooper 12: The shebang that worked on your machine but not in the sandbox

**What happened:** The hook scripts were written with `#!/usr/bin/env bash` at the top — the
conventional way to find bash via your `$PATH`. When Claude Code's hook runner executed them, it
failed with `env: bash: No such file or directory`.

**Why it happened:** The hook runner's environment is sandboxed — it doesn't inherit your full
shell
`$PATH`. `env` couldn't find `bash` because `/opt/homebrew/bin` (where Homebrew bash lives on Apple
Silicon) wasn't in that restricted path.

**Fix:** Use the absolute path to bash: `#!/bin/bash`. On macOS, system bash always lives at
`/bin/bash`. It's an older version (3.2, due to Apple's GPLv3 aversion), but more than capable
enough for jq-based scripting.

**Lesson:** Shebangs that use `env` are more portable across machines, but less reliable across
execution environments on the *same* machine. When your script must work in restricted environments
(CI runners, app sandboxes, Claude Code hooks), prefer absolute paths.

---

### 🎬 Blooper 13: The jq bootstrap that only checked half the question

**What happened:** After manually deleting all the tasks from `db.json` during testing, the hook
scripts stopped working silently. The database file existed, but had become `{}` (an empty object)
instead of `{"tasks":[]}`.

**Why it happened:** The original bootstrap check was:

```bash
if [ ! -f "$DB_FILE" ]; then
  echo '{"tasks":[]}' > "$DB_FILE"
fi
```

This only asked "does the file exist?" — not "is the file in a valid state?" When `db.json`
existed
but had no `.tasks` key, the subsequent `jq` upsert tried to run `any(.tasks[]; ...)` on a null
value, which failed silently with a non-zero exit code that was swallowed.

**Fix:** Check both conditions — file presence AND structural validity:

```bash
if [ ! -f "$DB_FILE" ] || ! jq -e '.tasks' "$DB_FILE" > /dev/null 2>&1; then
  echo '{"tasks":[]}' > "$DB_FILE"
fi
```

`jq -e` exits with code 1 if the result is `null` or `false`, making it a perfect validator.

**Film analogy:** Think of it like checking whether a film reel is loaded *and* properly threaded.
Checking only that the reel exists doesn't mean the projector can run it.

**Lesson:** File existence checks are necessary but not sufficient for structured data files. After
confirming the file exists, validate its expected shape. `jq -e '.key' file` is the idiomatic
one-liner for this in bash.

---

### 🎬 Blooper 14: Ghostty ignores `--args`, treats CLI flags as config

**What happened:** The "New Agent" button originally called `open -a Ghostty --args --command
claude`. On a running Ghostty instance, this just focused the existing window — `--command claude`
was silently ignored. When Ghostty was closed, opening it fresh showed a dialog: **"Configuration
Errors: command: value required / claude: invalid field"**.

**Why it happened:** Two separate issues:

1. **`open -a Ghostty --args ...`** —
macOS's `open` command is a single-instance launcher. If the app is already running, it just
activates the existing window and ignores `--args` entirely. This is by macOS design.

2. **Ghostty's CLI parser** — unlike most Unix tools, Ghostty parses its command-line flags the
same
way it parses its config file. `--command=claude` isn't a flag with a value; it's a config entry
`command` with value `claude` — but `command` requires a *list* value, not a string. And `claude`
as
a standalone argument has no key at all, making it an invalid config field.

**Fix:** AppleScript. Activate Ghostty, send Cmd+N to open a new window, then use System Events to
keystroke `claude` and press Enter:

```applescript
tell application "Ghostty" to activate
delay 1
tell application "System Events"
  tell process "Ghostty"
    keystroke "n" using command down
    delay 0.5
    keystroke "claude"
    key code 36
  end tell
end tell
```

**Lesson:** Terminal emulators don't have standardized CLI APIs. iTerm2 has AppleScript
dictionaries. Terminal.app has `do script`. Ghostty has neither — you have to simulate keyboard
input. When you need cross-terminal compatibility, detect `$TERM_PROGRAM` (the env var your terminal
sets) and branch to terminal-specific code.

---

### 🎬 Blooper 15: `TERM_PROGRAM` — the env var you didn't know you had

**The insight that came from Blooper 14:** Rather than hardcoding Ghostty logic, we discovered that
every major terminal sets `$TERM_PROGRAM` to its own name. This is the closest thing macOS has to
"default terminal" detection without querying system preferences.

| Terminal | `$TERM_PROGRAM` value |
|----------|-----------------------|
| iTerm2 | `iTerm.app` |
| Terminal.app | `Apple_Terminal` |
| Ghostty | `Ghostty` |
| VS Code terminal | `vscode` |
| Warp | `WarpTerminal` |

The variable is **inherited** by all child processes. So when you run `bun run dev` inside Ghostty,
the spawn-terminal server process inherits `TERM_PROGRAM=Ghostty` — and can use it to dispatch to
the right AppleScript at request time.

**Film analogy:** It's like checking the call sheet header to see which studio is running today's
shoot. The environment variable is inherited from the context that started the whole pipeline.

**Lesson:** Before writing platform-detection code, check what the platform tells you about itself.
Shell environments are full of inherited variables that encode useful context — `$TERM_PROGRAM`,
`$TERM`, `$COLORTERM`, `$SHELL`. Read them before reaching for system API calls.

---

## 6. Director's Commentary

### On "boring technology"

The architecture of this project deliberately avoids exciting choices: no WebSockets, no Redux, no
GraphQL, no edge functions. Each of those would solve a real problem — but not a problem *this*
project actually has. Senior engineers have a bias toward solutions that are simple enough to be
understood at 2am when something breaks.

Ask yourself before adding complexity: "Does this project *actually need* this, or does it just feel
more impressive?"

### On the `@/` path alias pattern

The `@/` prefix for imports (e.g., `@/components/Button`) is a convention that means "root of the
src directory." It prevents deeply-nested relative imports like `../../../components/Button`. You'll
see this in nearly every React/Vue/Next.js project. The machinery behind it:

1. TypeScript uses `tsconfig paths` to understand it for type-checking
2. The bundler (Vite) uses an alias or plugin to resolve it at build time

They must agree. `vite-tsconfig-paths` makes them agree automatically.

### On Testing: DOM, React, and the Tools That Test Them

Three concepts that seem obvious once you understand them, but can be fuzzy at first:

1. **jsdom is the stage, testing-library is the audience.**

- jsdom creates a fake DOM environment so your test can actually query nodes
(`document.querySelector`, etc.). Without it, there's no browser-like environment to test against.
- `@testing-library/react` runs your React components *into* that jsdom stage and provides queries
(`getByRole`, `getByLabelText`) that mimic how a user finds elements. The queries themselves are
generic (they work with any framework), but React's test library wraps them with React-specific
tooling (render functions, component lifecycle handling).
- Think of it this way: jsdom is the empty theater, testing-library is the script the actors follow,
`render()` puts the actors on stage, and queries find them from the audience's perspective.

2. **vitest vs Jest: Pick the tool that speaks your bundler's language.**

- Jest is a general-purpose test runner that works everywhere. It's battle-tested, well-documented,
but doesn't know about your Vite config.
- vitest is Jest-compatible but built *for* Vite. It understands your module resolution, path
aliases, and dev setup automatically. No extra config. The terminal output is also cleaner —
easier
to read at a glance.
  - For a Vite project, vitest is the obvious choice. For a non-Vite project, Jest is fine.

3. **Why @testing-library/dom exists separately from @testing-library/react:**

- DOM testing is framework-agnostic. The query logic ("find an element by role") works with React,
Vue, Svelte, plain HTML, etc.
- React testing adds React-specific concerns: how to render a component, how to interact with hooks,
how to handle component state changes.
- Separating them lets other frameworks (Vue, Svelte) build their own testing libraries on top of
@testing-library/dom without reinventing the query logic.
- **The lesson:** Good libraries separate concerns. Don't couple framework-specific code to generic
code. It makes both parts harder to maintain.

**Three vitest config details that tie everything together:**

1. **`globals: true` injects test functions globally** —
`describe`, `it`, `expect`, `beforeEach`, `afterEach` become available without imports.
Cleaner test files, but requires `vitest/globals` in your tsconfig.json types so TypeScript
recognizes them. Some libraries (like @testing-library/react) depend on globals being present
to auto-cleanup.

2. **`environment: jsdom`** — Tells vitest to use jsdom instead of Node's default environment.
Without this, tests that interact with the DOM (component rendering, querying elements) fail because
`document` doesn't exist.

3. **Path aliases need both TypeScript and Vite to understand them** — If you use `@/components`
in
test files, both the TS compiler and vitest's module resolution must know what `@/` means. This is
why `vite-tsconfig-paths` plugin + `tsconfig.json paths` are essential. Without them, import
resolution fails in tests, and you get module-not-found errors.

**On Test Utilities: The Mock Factory Pattern:**

**The problem it solves:**

When testing, you need realistic test data. The naive approach is to hand-craft every object in
every test:

```ts
test("builds tree correctly", () => {
  const task1 = {
    id: "1",
    name: "Test Task",
    status: "pending" as TaskStatus,
    agentType: "Explore",
    parentId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progressPercentage: 0,
    logs: [],
  };

  const task2 = {
    id: "2",
    name: "Another Task",
    status: "pending" as TaskStatus,
    agentType: "Explore",
    parentId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progressPercentage: 0,
    logs: [],
  };

  // ... finally, the actual test logic
});
```

**The smell:** You're writing 20 lines of setup to test 2 lines of actual logic. Every test needs
the same boilerplate. And if the `Task` type changes (you add a new required field), you have to
update *every single test*.

**The factory pattern solves this:**

A **factory function** is a helper that creates objects for you with sensible defaults. You give it
*only the parts that matter for this test*, and it fills in the rest:

```ts
function createMockTask(overrides: Partial<Task>): Task {
  return {
    // Sensible defaults — these work for most tests
    id: "1",
    name: "Test Task",
    status: "pending",
    agentType: "Explore",
    parentId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progressPercentage: 0,
    logs: [],
    // Let the caller override what matters for *this specific test*
    ...overrides,
  };
}
```

Now the same test becomes:

```ts
test("builds tree correctly", () => {
  const task1 = createMockTask({ id: "1" });
  const task2 = createMockTask({ id: "2" });
  // ... test logic
});
```

**How it works technically:**

- `Partial<Task>` is a TypeScript utility that makes all Task properties optional (not required).
So you can pass `{ id: "2" }` without typing out `name`, `status`, etc.
- The spread operator `...overrides` takes whatever the caller passed and **overwrites** the
defaults. If you call `createMockTask({ status: "running" })`, the returned object will have
`status: "running"` instead of `"pending"`.
- The caller can pass `{}` (empty object) to get all defaults, or pass specific fields they care
about for this test.

**When to smell that you need a factory:**

- You're writing the same object literal in 3+ tests
- The object has 5+ properties
- You find yourself copy-pasting setup code between tests
- When the type definition changes, you have to update 10 test files

**Why it's valuable:**

1. **Less boilerplate** — tests focus on the logic, not object construction
2. **Single source of truth** — if `Task` type changes, update one factory, all tests work
3. **Readable tests** — `createMockTask({ parentId: "1" })` is self-documenting. It says "I need a
task with a parent, and I don't care about the rest."

**This pattern appears in every mature codebase** — sometimes it's called a "factory," sometimes a
"builder," sometimes a "test fixture." The idea is always the same: **provide sensible defaults, let
tests override what matters.**

This is not vitest-specific — it's a general TypeScript testing pattern that works with any
framework.

**Pattern Recognition: When to Smell "I Need a Pattern"**

As you move from beginner to intermediate, you'll start noticing code smells — signs that
something
could be structured better. Here's a cheat sheet:

| Smell | What's happening | Pattern to consider | Why |
|-------|------------------|-------------------|-----|
| Copy-pasting the same code 3+ times | You're repeating setup, logic, or initialization | **Factory** (for creation) or **Helper function** (for logic) | DRY principle: Don't Repeat Yourself. One change should update one place, not ten. |
| You have one object but need it in multiple variants | Creating `UserAdmin`, `UserGuest`, `UserViewer` separately | **Factory** or **Builder** | Factory with options (`createUser({ role: 'admin' })`) is cleaner than three separate functions. |
| State that's used everywhere in your component | A value passed as a prop through 5 layers of components | **Context API** (React) or **State management** | Prop drilling (passing props through intermediate components that don't use them) is a smell. |
| Same logic appears in 2+ files | A sorting algorithm, validation rule, or data transformer | **Utility module** (a `.ts` file with reusable functions) | Extracting shared logic to one place makes it testable and maintainable. |
| Conditionals checking the same thing repeatedly | `if (user.role === 'admin')` appears in 5 places | **Helper function** like `function isAdmin(user) { return user.role === 'admin' }` | Centralizes the logic. If the definition of "admin" changes, you update one place. |
| Your component has multiple responsibilities | Rendering *and* fetching *and* filtering *and* formatting | **Split into smaller components** or **extract hooks** | One component should do one thing well. Easier to test, reuse, and understand. |
| You need to create complex objects with many options | Building a request with headers, auth, retry config, etc. | **Builder pattern** | Example: `new RequestBuilder().withAuth(token).withRetry(3).build()` reads left-to-right like instructions. |
| The same default values appear in many places | Every test file uses `status: "pending"`, every form has the same validation | **Constants file** or **Factory** | If defaults live in one place, they're easy to update. If they're scattered, you'll miss some. |

**The unifying principle:** All patterns exist to solve **repetition** and **clarity**. Ask
yourself:

- "If this changed, how many files would I need to update?"
- "If I read this code 6 months from now, would I understand it?"

If the answer to #1 is "many" or #2 is "no," a pattern could help.

**On Nested Data Structures in Tests: Array vs Object Confusion:**

When testing tree-structured data (like `TaskNode[]`), a common mental model mistake is confusing
which parts are arrays and which are objects:

```typescript
// Result structure
const result = [
  {
    id: "1",
    name: "Parent",
    children: [      // ← children is an ARRAY
      { id: "2", ... }  // ← this is an OBJECT (a child task)
    ]
  },
  { id: "3", ... }  // ← this is an OBJECT (a root task)
];

// DON'T DO THIS:
expect(result[1]).toHaveLength(2);  // ❌ result[1] is an object, not an array!

// DO THIS:
expect(result).toHaveLength(2);              // ✓ result is an array with 2 root tasks
expect(result[0].children).toHaveLength(1); // ✓ first root has 1 child
```

The pattern: **Array access uses numeric indices. Objects use dot notation.** When testing nested
data:

- `result` = array → can use `.length`, `.map()`, `.filter()`
- `result[0]` = object → can use dot notation to access properties (`.id`, `.name`, `.children`)
- `result[0].children` = array → can use `.length` again

**Visualization trick:** When logging nested data with `console.log(JSON.stringify(result, null,
2))`, look at the brackets:

- `[ { ... }, { ... } ]` — outer brackets mean this level is an array
- `{ "children": [ { ... } ] }` — inner brackets mean `.children` is an array

If you're about to call `.length`, the thing you're calling it on must be inside square brackets in
the JSON.

### On json-server as a prototyping tool

json-server is one of those tools that looks like a toy but saves hours of work. It's a REST API
from a flat JSON file — reads, writes, filters, pagination, all included. For any project where
you
need a backend for prototyping but don't want to write one, reach for json-server first.

When you outgrow it (auth, complex queries, relations), you swap it for a real backend. The frontend
code doesn't change because the API contract (REST over HTTP) stays the same.

### On file-based state vs database

`db.json` is essentially a file-based database. This works for a single-user local tool but would
break down with concurrent writes (two processes writing simultaneously would corrupt the file) or
large datasets (reading 10MB of JSON on every poll is slow). For this project, it's perfect. For a
production system serving multiple users, you'd want SQLite at minimum.

### On Accessibility as a Design Constraint (Not an Afterthought)

**The pattern:** When this project's UI was finished and "visually polished," a RAMS accessibility
audit revealed ~12 issues across three severity levels. The first instinct was to think
"accessibility is extra work" — but this mindset is backward. Accessibility is architecture.

**What we found:**

- 4 critical issues: icon-only buttons without `aria-label`, searchable inputs without accessible
names
- 4 serious issues: clickable rows without keyboard handlers, missing focus rings, touch targets
too small
- 4 moderate issues: decorative icons not hidden from screen readers, contrast ratios below 4.5:1,
missing live regions

None of these were hard to fix *once discovered*. But they all required **intentional design
decisions**, not coding heroics.

**The mental model shift:** Accessibility isn't a "nice-to-have" feature. It's part of the
fundamental contract between your code and the browser. The browser has features (aria attributes,
semantic HTML, keyboard handling) specifically for this. Ignoring them is like ignoring TypeScript
errors — you're trading short-term speed for long-term fragility.

**Three concrete learnings:**

1. **Icon-only buttons are broken by default.** A button with only an icon (`<button><IconRefresh
/></button>`) is invisible to screen readers. The fix is one line: `aria-label="Refresh"`.
This isn't extra; it's required. If your icon component doesn't have an accessible name,
the button doesn't work.

2. **Clickable elements need keyboard support.** A row with `onClick` is pointless for keyboard
users. The fix is straightforward:

   ```jsx
   onClick={handleClick}
   onKeyDown={(e) => {
     if (e.key === 'Enter' || e.key === ' ') {
       e.preventDefault();
       handleClick();
     }
   }}
   tabIndex={0}
   ```

This is not "extra accessibility code" — it's the price of entry for interactive elements. Expect
it.

3. **Invisible UX is real UX.** The `-m-2` padding trick (expanding a 20px button's tap zone to 36px
without changing its visual appearance) taught a film-production lesson: what users see isn't all
the information your design conveys. Like a film credit that lists production assistants nobody sees
— it still matters. `aria-live="polite"` announcements, `aria-expanded` toggles, and unseen focus
rings are all real UI. They just happen to be invisible to non-assistive users.

**The color palette example:** This project uses a minimalist stone-based palette. During the audit,
it became clear that "running" (stone-200) vs "failed" (stone-300) — both in muted gray — was
hard
to scan. The design fix wasn't to compromise the aesthetic. It was to use semantic colors
intentionally: "running" → slate-400 (blue-gray), "failed" → red-500, "paused" → amber-400.
These
colors were *always in the Tailwind palette* — they just hadn't been chosen. The RAMS review
surfaced a design decision that was always available.

**Film production analogy:** Accessibility is like continuity in film. You might not consciously
notice a well-maintained prop across cuts, but you *will* notice if it's wrong. The viewer doesn't
see the continuity supervisor's notes — but without them, the film falls apart. Accessibility is
the
continuity supervisor of the web.

**The lesson:** Don't save accessibility for the end. Make it a design constraint from the start.
Choose semantic colors. Use Radix UI primitives (they handle a11y internally). Plan for keyboard
navigation. These decisions cost nothing early but everything later.
