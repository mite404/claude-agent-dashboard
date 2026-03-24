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

**The Complete Testing Stack: Four Layers That Work Together**

When you `bun test`, there are four distinct tools at play, each doing one job:

| Layer | Package | What it does | Analogy |
|-------|---------|-------------|---------|
| **Virtual Browser** | `jsdom` | Creates a fake DOM environment (`document`, `window`, `querySelector`). Without it, there's no browser to test against — you'd be testing React in a void. | The **stage backlot**. A physical place where your actors (components) can be placed. |
| **Test Runner** | `vitest` | Runs tests, provides `describe`, `it`, `expect`, `vi`. Understands Vite aliases and config automatically. The assertion engine that says "yes" or "no" about your code. | The **director and cinematographer**. Sets up the scene, calls action, reviews the footage. |
| **Render & Query** | `@testing-library/react` | Takes your React components and renders them *into* that jsdom stage. Provides queries (`getByText`, `getByRole`, `within`) that mimic how a real user finds elements on a page. | The **camera crew and lighting**. They put the actors on the stage and position the camera to see what the audience would see. |
| **DOM Matchers** | `@testing-library/jest-dom` | Adds **custom `expect` matchers** for DOM elements — `.toBeInTheDocument()`, `.toBeDisabled()`, `.toHaveClass()`, `.toHaveValue()`. Without it, vitest's generic assertions (`toBe`, `toEqual`) don't know what a DOM element is. | The **focus puller and script supervisor**. They ensure the camera is focused on the right thing and verify it matches the script. |

**Why all four?**

`jsdom` + `vitest` alone = you can run code, but you can't test DOM behavior.

`jsdom` + `vitest` + `@testing-library/react` alone = you can render React and
query elements, but assertions are clunky:

```ts
// Without jest-dom — technically works, but terrible feedback:
expect(screen.queryByText('Test Node')).not.toBeNull()
```

All four together = clear, readable tests with useful failure messages:

```ts
// With jest-dom — reads like English, fails with actionable info:
expect(screen.getByText('Test Node')).toBeInTheDocument()
```

**Setup checklist:**

1. ✅ `jsdom` and `vitest` — configured in `vite.config.ts`
   (`environment: "jsdom"`, `globals: true`)
2. ✅ `@testing-library/react` and `@testing-library/dom` — already in package.json
3. ✅ `@testing-library/jest-dom` — install + setup file

**The Setup Files: How a Modern TypeScript Vitest Suite Boots Up**

A testing suite has **one job at startup:** extend `expect()` with DOM matchers
before running tests. Here's the choreography:

**The three-file handshake:**

1. **vite.config.ts** — Tells vitest where to find the setup:

```ts
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  setupFiles: ['./vitest-setup.ts'],  // ← Run this file before tests
});
```

2. **vitest-setup.ts** — The setup file that runs BEFORE all tests. It's where
   imports affecting global state live:

```ts
// vitest-setup.ts
import '@testing-library/jest-dom/vitest'
// Any other global setup goes here
```

3. **The right tsconfig** — Tells TypeScript this setup file exists
   (so you get types for jest-dom matchers).

The jest-dom docs say "add this to `tsconfig.json`" — but that's written for a
single-tsconfig project. This project has three tsconfig files with a
**coordinator pattern**:

| File | Role | Contains |
|------|------|----------|
| `tsconfig.json` | Coordinator only | Just `"references"` pointers. `"files": []` means it holds zero files itself. |
| `tsconfig.app.json` | App + tests | `src/`, `vitest-setup.ts`, jest-dom types. **This is what the docs mean by "tsconfig.json".** |
| `tsconfig.node.json` | Vite config only | `vite.config.ts`, `noEmit: true` |

So the types and include go in `tsconfig.app.json`, not the root:

```json
// tsconfig.app.json — covers src/ where test files live
{
  "compilerOptions": {
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "./vitest-setup.ts"]
}
```

The root coordinator stays empty:

```json
// tsconfig.json — do NOT add types or include here
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**Why can't you add `include` to the coordinator?**

When `tsconfig.json` has `"files": []` + `"references"`, TypeScript treats it as
a pure coordinator. The moment you add `"include"`, it becomes a real project too
— and TypeScript then enforces composite project rules: all referenced
sub-projects must be able to *emit* files. But `tsconfig.node.json` has
`"noEmit": true`, which conflicts. Error: *"Referenced project may not disable
emit."*

The fix is to leave the coordinator alone and put things where the files actually live.

**The execution order:**

```
bun test
  ↓
vitest reads vite.config.ts
  ↓
Finds setupFiles: ['./vitest-setup.ts']
  ↓
Loads and executes vitest-setup.ts
  ↓
vitest-setup.ts imports '@testing-library/jest-dom/vitest'
  ↓
jest-dom extends the global 'expect' object with .toBeInTheDocument(), .toHaveClass(), etc.
  ↓
Now all test files can use those matchers
  ↓
Run tests
```

**Common mistakes:**

1. **Importing jest-dom in vite.config.ts** — runs in the bundler's context, not
   the test runtime. Matchers don't get registered. Tests fail with
   "toBeInTheDocument is not a function."
2. **Putting `include`/`types` in the coordinator tsconfig.json** — breaks the
   composite project wiring. Error: "Referenced project may not disable emit."
3. **Following docs literally without checking your tsconfig structure** — docs
   are written for single-tsconfig projects. When you have multiple, find the one
   that covers your source files and treat that as "your tsconfig.json."

**Why multiple tsconfigs at all?**

`vite.config.ts` runs in Node.js. `src/` runs in the browser. They need
different compiler settings (different `lib`, different globals). Splitting them
prevents browser code from accidentally using Node APIs and vice versa. The
coordinator just wires them together for IDE tooling.

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

### On Testing Queries: `getByText` vs `getByRole` — Why Accessibility Matters in Tests

**The pattern:** Testing Library provides multiple ways to find elements. Two common ones:

```typescript
// ❌ Implementation detail — finds ANY element with this text
screen.getByText('Cancel')

// ✓ Accessibility-first — finds a BUTTON with this accessible name
screen.getByRole('button', { name: /cancel/i })
```

**Why this matters:** `getByText` tests *what* appears on screen. `getByRole` tests
*how* the screen is built — and that's how users and assistive tech interact.

**The concrete example from TaskTree:**

- `getByText('Parent Task')` passes whether the task name is in an `<h3>` (correct)
  or a `<div>` (broken for accessibility).
- `getByRole('heading', { name: 'Parent Task' })` **fails** if you use `<div>`
  instead of `<h3>`.

Your test just caught an accessibility regression before it shipped.

**Three query patterns to know:**

1. **Buttons:** `getByRole('button', { name: /cancel/i })`
   - Ensures you have `<button>` or `role="button"` with an accessible name
   - Would fail if you built a button as a `<div onClick>`

2. **Headings:** `getByRole('heading', { name: 'Title' })`
   - Ensures you have semantic heading HTML (`<h1>` through `<h6>`)
   - Screen readers announce these and users can navigate by headings

3. **Text without semantic role:** `getByText('Some status message')`
   - OK for generic text that doesn't need a role
   - Use sparingly; prefer semantic queries

**The testing-as-accessibility-checker mindset:** When you write tests with
`getByRole`, you're checking that the UI is *built correctly*, not just that it
works. A test passing `getByRole('button')` confirms your button is an actual
button, not a div pretending to be one.

This is why the tutorial shifted you from `getByText` to `getByRole`. It's not
just better testing practice — it's accessibility by design.

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

### On Drizzle's Type System: Generic vs. Inferred Types

**The core problem:** When you type a Drizzle table definition, you face a choice between letting
TypeScript infer the full type (column names, types, constraints) or declaring it as a generic
`SQLiteTable`. This seems like a style preference, but it has real consequences for what code you
can write.

**Generic `SQLiteTable` — the trap:**

```typescript
export const sessionsTable: SQLiteTable = sqliteTable('sessions', {
  id: text().primaryKey(),
})

// Later, in a foreign key reference:
sessionId: text().references(() => sessionsTable.id)  // ← ERROR: 'id' does not exist
```

The error happens because `SQLiteTable` (without type parameters) is a generic type — it says "this
is *a* table, but I don't know what columns it has." TypeScript can't prove that `sessionsTable.id`
exists, so it rejects the code.

**Inferred type — the solution:**

```typescript
export const sessionsTable = sqliteTable('sessions', {
  id: text().primaryKey(),
})

// Later, in a foreign key reference:
sessionId: text().references(() => sessionsTable.id)  // ✅ Works
```

When you drop the type annotation, TypeScript infers the full type from `sqliteTable()`. This type
includes column information, so TypeScript knows `.id` exists. The inferred type is a **subtype** of
`SQLiteTable` — it has all the general table properties *plus* specific column access.

**When to use each:**

- **Generic `SQLiteTable`**: Write utility functions that work with *any* table, regardless of
columns. Example:

  ```typescript
  function logTableName(table: SQLiteTable) {
    console.log(table.tableName)  // Only properties all tables have
  }
  ```

- **Inferred type**: Always for table definitions. You need column access for queries and foreign
keys.

**On constraints and naming:**

The difference between TypeScript and SQL names (camelCase vs snake_case) is separate from type
safety. When you define a column, you specify constraints (`.primaryKey()`, `.notNull()`,
`.unique()`, `.references()`) that apply *regardless* of naming:

- **Unique keys**: A column needs `.unique()` when "no two rows should have the same value."
- **Foreign keys**: A column needs `.references()` to point to another table. Multiple rows in the
referencing table can point to the *same* parent — so `.unique()` is wrong on a foreign key.
- **Primary keys**: `.primaryKey()` is implicitly unique. It's the table's single-row identifier.
- **Casing**: With `casing: 'snake_case'` enabled on the database client, TypeScript keys (`appliedAt`)
automatically become SQL column names (`applied_at`). The `.unique()` constraint still applies — it's
just now enforcing uniqueness on the SQL column, not the TypeScript key.

**The lesson:** Type annotations are convenient but expensive. Let TypeScript infer, especially when
you're building references between tables. The inferred type is more specific and more useful.

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

---

## Feature: Checkpoint View + Column Reorder (2026-03-07)

### The Problem

The old log expansion showed raw `LogEntry[]` lines — timestamps, log levels, message strings.
Fine for debugging, but useless for project management. When an orchestrator spawns five agents
and you want to know "is the research phase done?", a wall of `INFO` lines doesn't answer that.
The *subtasks* do.

### The Pattern: Smart Detail Fallback

The row expansion now follows a decision tree:

```
Click row
  ↓
Does this task have children (sub-tasks)?
  YES → show CheckpointRow (subtask checklist)
  NO  → does it have logs?
          YES → show LogDetailRow (original log view)
          NO  → nothing (expand toggle hidden)
```

Think of it like a film's shot list vs. raw production notes. The shot list (checkpoints) is the
director's view — structured, scannable, pass/fail. The raw notes (logs) are the script
supervisor's view — useful when something goes wrong and you need the details. The right view
depends on whether the "scene" has structure.

### The Data Model (No Schema Changes)

`TaskNode` already had `children: TaskNode[]` — built client-side from `parentId` in
`useTaskPolling.ts`. The checkpoint view just renders those children as a list. No new API fields,
no new db.json changes. The tree structure was always there; we just started displaying it
differently.

```
TaskNode {
  id, name, status, agentType ...
  children: TaskNode[]   ← these ARE the checkpoints
}
```

Each child gets a status icon (`✓ ● ○ ◐ ✗`), its name, a `StatusBadge`, and its elapsed time.

### Column Reorder + Subtasks Column

The old column order had `ID` as the second column — useful for debugging, not for project
management. It's now hidden from display (`id` still exists in the data). A new `Subtasks` column
replaced it, showing `done/total` count (e.g. `2/5`). This acts as an at-a-glance signal that a
row is expandable — no separate indicator needed. The `LOGS` pill in the Task name cell was
removed for the same reason.

New column order: **Task · Agent · Status · Subtasks · Progress · Duration**

### Senior Engineer Note: One Source, Multiple Views

Don't change your data model every time you want a new view. The checkpoint list and the log view
both consume data that was already there. The "intelligence" is entirely in the render layer —
which component gets shown based on what the task contains. Same footage, different cuts for
different audiences.

---

## Phase 9: Hook Pipeline Rewrite — "The Ghost Writer Bug" (2026-03-08)

### 🎬 Blooper 16: Writing to a file nobody is reading

This one looked like everything was working — the dashboard UI loaded, tasks appeared in
`db.json` when agents ran, the hooks fired without errors. But the table never updated. Why?

**The setup.** json-server works like this: at startup, it reads `db.json` into memory and then
*serves its in-memory copy*. All reads and writes go through that in-memory store. When the
dashboard calls `GET /api/tasks`, it hits json-server's RAM, not the file on disk.

**The bug.** The original hook scripts used `jq` to write directly to `db.json` on disk:

```bash
jq --argjson task "$NEW_TASK" '.tasks += [$task]' "$DB_FILE" > "$DB_FILE.tmp" \
  && mv "$DB_FILE.tmp" "$DB_FILE"
```

This is a **completely valid shell pattern** — it's even how json-server's own beta docs describe
persistence. But there's a timing trap: json-server never re-reads `db.json` after startup.
The file on disk kept changing, but json-server's memory didn't know. The REST API kept returning
whatever was loaded at boot.

Film analogy: imagine a script supervisor writing last-minute changes into the printed script
sitting on the craft services table — but the director is working from a separate photocopy made
at 6am. All the changes are real and on paper, but the director never sees them.

**The diagnosis.** One curl command revealed it instantly:

```bash
curl -s http://localhost:3001/tasks | jq 'length'
# → 0
```

The API returned an empty array even though `db.json` had 4 tasks. json-server's memory was stale.

**The fix.** Rewrote both hooks to talk to the REST API directly using `curl`:

```bash
# Pre-hook: create task via API instead of writing to file
curl -s -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d "$NEW_TASK" > /dev/null

# Post-hook: GET existing task, merge update, PUT it back
EXISTING=$(curl -s "http://localhost:3001/tasks/$TASK_ID")
UPDATED=$(echo "$EXISTING" | jq '. + { status: $status, logs: (.logs + [$newlog]) }' ...)
curl -s -X PUT "http://localhost:3001/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "$UPDATED" > /dev/null
```

Note the POST for pre-hook (creates), and GET→mutate→PUT for post-hook. json-server's `PATCH`
does a *shallow merge* — it would overwrite the `logs` array instead of appending to it, so we
need to read the full record, build the updated version, and PUT it back as a full replace.

**The db.json bootstrap stays.** Even though we no longer write tasks to disk directly, the
bootstrap check (`if [ ! -f "$DB_FILE" ]...`) is kept in both scripts. It's now a *pre-flight
check* — it ensures `db.json` is valid JSON with a `tasks` key so that if json-server ever
restarts, it comes back up cleanly rather than crashing on a missing or corrupt file.

**Lesson:** When your data store has two layers (in-memory + file), always ask: *which layer is
actually being read?* The answer is often not what you expect. Verify with a direct API call
before assuming file writes are visible.

---

### 🎬 Blooper 17: Silent failures are just hidden bugs

After fixing the write path, a new question: what happens when `curl` fails? Maybe json-server
isn't running yet. Maybe a port is blocked. The original fix redirected all curl output to
`/dev/null` — tidy, but invisible.

**The problem with silent failures** is that they look identical to successes from the outside.
A failed hook and a working hook both produce zero terminal output. You only notice something
is wrong when you check the dashboard and tasks aren't there — but by then, you've lost the
context of *when* it failed and *why*.

**The fix: a shared log file + terminal stream.**

Each hook now has a `log()` function that appends timestamped lines to `logs/hooks.log`:

```bash
log() {
  echo "[$(date -u +"%H:%M:%S")] [pre-hook] $*" >> "$LOG_FILE"
}
```

`curl` is called with `-w "\n%{http_code}"` to capture the HTTP status code. Success and failure
both get logged explicitly:

```bash
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST ...)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "201" ]; then
  log "OK: created task $TASK_ID (\"$TASK_NAME\", $SUBAGENT_TYPE)"
else
  log "ERROR: POST /tasks failed (HTTP $HTTP_CODE) — is json-server running on :3001?"
fi
```

Then `bun run dev` was updated to tail that file as a fourth process in `concurrently`:

```json
"dev": "concurrently --names \"vite,json,hooks,spawn\"
  \"vite --port 5173\"
  \"json-server --watch db.json --port 3001\"
  \"tail -F logs/hooks.log\"
  \"bun scripts/spawn-terminal.ts\""
```

`tail -F` (capital F) follows the file even across log rotations, and waits for the file to
be created if it doesn't exist yet — useful on a fresh checkout before any hook has fired.

Now the terminal shows four labeled streams side by side:

```
[vite]   VITE v6.x ready → http://localhost:5173
[json]   Loading db.json...
[hooks]  [03:59:01] [pre-hook] OK: created task toolu_01X ("Explore codebase", Explore)
[hooks]  [04:00:12] [post-hook] OK: updated task toolu_01X → completed
```

**Lesson:** Observability is not a luxury for production systems — it's a debugging requirement
for local tools too. A hook that fails silently is worse than one that crashes loudly, because
the silent failure lets you believe the system is working when it isn't. Log the outcome of
every external call. Make failures as visible as successes.

---

### 🎬 Blooper 18: The frontend trusted the API too much

One more defensive layer. When all tasks are deleted from the UI, the API returns `[]`. But
what if it returns something weirder — `null`, `{}`, an HTML error page that parses as a
non-array? The original polling hook did:

```typescript
const data: Task[] = await res.json();
setTree(buildTree(data));
```

`buildTree` uses `for (const task of tasks)` internally. If `tasks` is `null` or an object,
that throws `TypeError: null is not iterable` — a crash that wipes the entire table view.

The fix is a one-liner guard before the data hits `buildTree`:

```typescript
const raw = await res.json();
const data: Task[] = Array.isArray(raw) ? raw : [];
```

Now, whatever the API returns, the worst case is an empty table — not a crash. The `error`
state in the hook already handles `!res.ok`, so HTTP errors show a banner. This guard handles
the weirder case: a `200 OK` response with unexpected body shape.

**Film analogy:** This is like having your editor handle a missing reel gracefully — cut to
black and continue, rather than the projector catching fire. The audience sees nothing where
the scene should be, which is bad, but not as bad as burning down the theater.

**Lesson:** Don't trust external data, even from your own API. Always validate shape before
passing data to code that assumes structure. `Array.isArray()` is the cheapest guard you'll
ever write.

---

## Phase 10: parentId — The Sticky Note Workaround (2026-03-08)

### The Problem: Hooks Are Blind to Call Hierarchy

When Claude Code fires a `PreToolUse` hook, it passes this JSON payload via stdin:

```json
{
  "tool_use_id": "toolu_abc123",
  "tool_input": {
    "description": "Explore the codebase",
    "subagent_type": "general-purpose",
    "run_in_background": false
  }
}
```

That's the full picture the hook gets. No `parent_tool_use_id`. No call stack. No indication
that this agent was launched *by* another agent. Every tool call looks like a top-level event.

So the original hook hardcoded the only honest answer:

```bash
parentId: null,  # no way to infer it
```

This worked fine for flat task lists. But it meant the dashboard could never show a
parent-child hierarchy — all tasks were siblings at the root level, regardless of how Claude
actually orchestrated them.

### The Constraint: What Can We Actually Control?

To establish a parent-child relationship, the hook needs to know the parent task's ID *before*
the child task is created. The hook context gives us exactly one string we control: the
`description` field. That's it.

Everything else in the hook payload — `tool_use_id`, `subagent_type`, `run_in_background` —
is set by Claude Code itself. But the description? That's whatever string the orchestrating
Claude writes when calling the Agent tool.

### The Workaround: Encoding Metadata in the Description

The solution is to treat the description like a **film slate** — the clapperboard a camera
operator holds up before a take. The hook (camera) can only read what's written on the slate.
So we started writing the parentId on the slate:

```
"Explore the hook scripts [parentId:orchestrator-1772949293]"
```

The hook then does two things:

1. **Extracts** the tag → `PARENT_ID=orchestrator-1772949293`
2. **Strips** the tag → `TASK_NAME="Explore the hook scripts"` (clean display name)

```bash
PARENT_TAG=$(echo "$RAW_NAME" | grep -oE '\[parentId:[^]]+\]' || true)
if [ -n "$PARENT_TAG" ]; then
  PARENT_ID=$(echo "$PARENT_TAG" | sed 's/\[parentId://;s/\]//')
  TASK_NAME=$(echo "$RAW_NAME" | sed 's/ \[parentId:[^]]*\]//' ...)
else
  PARENT_ID=""
  TASK_NAME="$RAW_NAME"
fi
```

And in the task payload, jq conditionally sets the field:

```bash
parentId: (if $parentId == "" then null else $parentId end)
```

The dashboard's `buildTree()` function already handles `parentId` correctly — it was always
wired to build a tree from a flat list using parent references. The only missing piece was the
hook actually populating the field.

### The Tradeoff

This is a pragmatic workaround, not a clean solution. The description field is meant to be
human-readable. Encoding machine metadata in it is a bit like writing your SSN in the memo
field of a check — it works, but it's not what the field was designed for.

The proper fix would be Anthropic adding a `parent_tool_use_id` field to the hook payload
natively. Until then, the `[parentId:XXX]` convention is the only option that doesn't require
modifying Claude Code itself.

**Senior Engineer Note:** When you hit an API surface that doesn't expose what you need, look
for the fields you *do* control before giving up. Sometimes the workaround is "write metadata
into the one string field you own." It's not elegant, but it ships — and the workaround is
clearly documented so the next person knows why it exists and when to replace it.

## Phase 8: Polish Sprint (2026-03-08)

Five quality-of-life improvements to `TaskTable.tsx` and one CSS foundation.

### Bigger Log Window

`max-h-64` (256px) → `max-h-96` (384px) on `LogDetailRow`'s scroll container. At ~20px per row
(`text-xs` + `py-0.5`), that's roughly 17 visible rows before scrolling — up from ~11. No
structural change, just a single Tailwind class swap.

### Auto-Scroll Logs (Smart Terminal Follow)

The log panel now follows new entries the same way a terminal does: latest lines appear at the
bottom, oldest scroll off the top. Implementation uses a `useRef` on the scroll container div
and a `useEffect` that watches the `logs` prop:

```typescript
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
  if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}, [logs]);
```

The 60px threshold is the "smart" part. If you've scrolled up to read an older entry, the panel
leaves you there. Only when you're near the bottom does it resume following. This mirrors the
behavior of iTerm, VS Code's integrated terminal, and Slack — "follow unless I've opted out."

### Clear Done Button

A "Clear done" button appears in the toolbar whenever the task tree contains at least one
`completed` or `cancelled` task. It calls `DELETE /api/tasks/:id` (via the existing `deleteTask`
helper) for each terminal task in parallel, then refreshes.

The guard `hasCompletedTasks` is computed fresh on each render from the full tree:

```typescript
const hasCompletedTasks = collectAllTasks(tree).some(
  (t) => t.status === "completed" || t.status === "cancelled",
);
```

`collectAllTasks` is a recursive flattener — it walks the parent/child tree and returns every
node as a flat array. The button only renders when this is true, so the toolbar stays clean.

### Session Filter

> **Updated 2026-03-09** — this was redesigned. See below.

The original session filter was a timestamp gate: `useRef(new Date())` captured when the
dashboard opened, and the filter dropped tasks created before that moment. Simple, but blind
— it had no concept of what a "session" actually was.

After hook scripts gained access to `session_id` from Claude Code, tasks gained a `sessionId`
field. This unlocked a proper session-aware design.

**Current implementation** — a multi-select popover (matching Status and Agent filter style):

```typescript
// State is now a Set of sessionId strings, not a boolean
const [sessionFilter, setSessionFilter] = useState<Set<string>>(new Set());

// Derive one option per unique sessionId, labeled by the earliest root task's name
const sessionOptions = useMemo(() => {
  const groups = new Map<string, TaskNode[]>();
  for (const task of collectAllTasks(tree)) {
    if (!task.sessionId) continue;
    (groups.get(task.sessionId) ?? (groups.set(task.sessionId, []), groups.get(task.sessionId)!))
      .push(task);
  }
  return [...groups.entries()].map(([sid, tasks]) => {
    const label = tasks
      .filter(t => !t.parentId)
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0]?.name ?? sid.slice(0, 8);
    return { id: sid, label };
  });
}, [tree]);
```

The label for each session is the name of its **earliest root-level task** — the first Agent
call that started that session's work. Think of it as naming a film reel by its first shot.

**Why root task, not session ID?** UUIDs are meaningless to humans. The task name — "Review the
auth system", "Fix bug in TaskTable" — is the semantic label you actually remember.

**Why multi-select?** Sometimes you want to compare two sessions side-by-side. A boolean toggle
forces you to choose one. A popover doesn't.

### New Task Row Fade-In

When a new task row appears (hook fires → json-server POST → polling picks it up), it slides
down from 6px above its final position over 220ms. This visual cue confirms something happened
without being distracting.

Implementation tracks which IDs have been seen before:

```typescript
const knownIds = useRef<Set<string>>(new Set());
const [newIds, setNewIds] = useState<Set<string>>(new Set());

useEffect(() => {
  const all = collectIds(tree);
  const fresh = all.filter((id) => !knownIds.current.has(id));
  all.forEach((id) => knownIds.current.add(id));
  if (fresh.length > 0) {
    setNewIds(new Set(fresh));
    setTimeout(() => setNewIds(new Set()), 250);
  }
}, [tree]);
```

`knownIds` is a `useRef` because it's write-only tracking state — we never need React to
re-render when it changes. `newIds` is `useState` because setting it IS what triggers the
animation class to appear on the row. The `setTimeout(250)` clears the animation class after
the 220ms keyframe finishes, so the same task won't animate again next poll.

The keyframe in `index.css`:

```css
@keyframes rowFadeIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### Dark / Light Mode Toggle (Foundation)

A sun/moon button in the toolbar toggles a `.light` class on `<html>`. The CSS variable block
`:root.light { ... }` in `index.css` overrides the stone-950 dark palette with stone-50 light
values for `--color-background`, `--color-surface`, etc.

**The honest scope of this feature:** The body background and scrollbar respond correctly.
Components using hardcoded Tailwind stone classes (`bg-stone-900`, `text-stone-500`, etc.) do
NOT — they're not wired to the semantic token CSS variables. A full light mode requires
replacing every hardcoded color class with a semantic token class (`bg-surface`, `text-muted`,
etc.), which is a larger refactor. The toggle is a foundation — it makes the behavior available
and the override mechanism is in place. Full coverage is the next step.

### Senior Engineer Note: useRef vs useState

This phase introduced two cases of `useRef` used as "invisible state":

- `sessionStart` — captured once at mount, never changes, never needs to trigger a re-render
- `knownIds` — mutated every poll cycle, but changes to it should never cause a re-render

The rule: **if reading a value doesn't need to update the UI, it belongs in a `useRef`, not
`useState`.** Putting `knownIds` in `useState` would cause an extra render on every poll cycle
just to track which IDs we've already seen — completely wasted work.

### Senior Engineer Note: Tailwind v4 Interactive States Are CSS Variables

When implementing the orange focus ring on the search input in light mode, a key pattern emerged.
The `focus-visible:ring-stone-500` class on `<Input>` generates this CSS:

```css
.focus-visible\:ring-stone-500:focus-visible {
  --tw-ring-color: var(--color-stone-500);
}
```

Tailwind's ring system is entirely variable-driven. The ring color, size, and offset are
composed from `--tw-ring-color`, `--tw-ring-offset-width`, etc., and combined into a final
`box-shadow` value. To change just the color in light mode — without touching the component,
without duplicating the size/offset, without adding a new Tailwind class — you override only
the variable in a scoped CSS selector:

```css
:root.light input:focus-visible {
  --tw-ring-color: var(--color-accent);
}
```

This is precise surgical override. The ring still fires on `focus-visible`, still uses the
same `ring-1` pixel width, still has the same offset. Only the color changes.

**The broader pattern:** In Tailwind v4, all "interactive state" utilities — rings, shadows,
gradient stops, outline colors — are CSS variable-driven. Anywhere you need a scoped override
(per-theme, per-component, per-context), reach for the variable before reaching for a new
class. The same technique works for:

- `--tw-shadow-color` to recolor a `shadow-lg` in dark/light context
- `--tw-ring-offset-width` to change the ring gap without a utility class
- `--tw-gradient-from` / `--tw-gradient-to` to retheme a gradient locally

Think of the Tailwind utility class as setting the *default* value of a CSS variable. Your CSS
can always override the variable downstream without knowing what the utility class was.

### 🎬 Blooper 19: The Theme Toggle That Painted White Before It Was Done

#### What went wrong

The first version of the light/dark toggle used a React `useEffect` to apply the `.light` class
to `<html>`:

```typescript
useEffect(() => {
  document.documentElement.classList.toggle("light", lightMode);
}, [lightMode]);
```

Clicking the sun/moon button caused a visible white flash across the entire screen — some
elements momentarily went pure white or over-saturated before settling into the new theme.

#### Why it happened — two compounding causes

**Cause 1: `transition-colors` on everything.**
`TableRow` applies `transition-colors` as a base class. Every row, button, and border in the
table has a CSS transition on `background-color`, `color`, and `border-color`. When the stone
palette flips from dark (stone-950 = near-black) to light (stone-950 = pure white), those
transitions don't jump — they *animate*. Interpolating between oklch(0.09) and oklch(1.0)
passes through the full brightness range, including pure white at the midpoint. On a table with
50 rows, that's 50 simultaneous white flashes.

**Cause 2: `useEffect` fires asynchronously.**
`useEffect` runs after React commits the render to the DOM, but before the browser paints.
However, the class change and the transition animations are driven by the browser's own
rendering pipeline, not React's. The mismatch in timing meant there was a window where React's
state said "light mode" but the DOM hadn't caught up — causing a half-painted intermediate
state to appear on screen.

#### The fix — three parts working together

**Part 1: A CSS kill switch.**

```css
:root.no-transition,
:root.no-transition * {
  transition: none !important;
}
```

One rule that nukes every transition across the entire document when `.no-transition` is on
`<html>`. The `!important` is intentional — it needs to beat all the `transition-colors`
utility classes, which are generated without `!important`.

**Part 2: Synchronous DOM manipulation instead of `useEffect`.**

The toggle was moved out of `useEffect` and into a direct click handler:

```typescript
const handleThemeToggle = () => {
  const next = !lightMode;
  const root = document.documentElement;
  root.classList.add("no-transition");     // kill switch ON
  root.classList.toggle("light", next);    // palette flips (no transitions, no flash)
  setLightMode(next);                      // React state syncs (for button icon)
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      root.classList.remove("no-transition") // kill switch OFF
    )
  );
};
```

By doing the DOM manipulation synchronously in the click handler, the `no-transition` and
`light` class changes happen in the *same JavaScript execution context* — the browser hasn't
had a chance to paint anything yet.

**Part 3: The double `requestAnimationFrame` — the common single-RAF trap.**

This is the part most developers get wrong. The instinct is to write:

```javascript
root.classList.add("no-transition");
root.classList.toggle("light", next);
requestAnimationFrame(() => root.classList.remove("no-transition")); // ← WRONG
```

But a single RAF fires *before the next paint*, not after it. The sequence with single RAF:

```
① classList operations (sync)
② RAF callback fires → removes no-transition
③ Browser paints the new theme  ← transitions ARE active again here → flash returns
```

The transitions are back on before the new theme is painted. We fixed nothing.

With double RAF:

```
① classList operations (sync)
② RAF 1 fires (before paint N) → schedules RAF 2
③ Browser paints the new theme (no-transition still on → instant snap, no flash) ✓
④ RAF 2 fires (after paint N) → removes no-transition
⑤ Future interactions have transitions again (hover, focus work normally)
```

The first RAF brackets the paint. The second fires after it. `no-transition` covers exactly
the one frame where the palette swap happens, and nothing else.

#### Why this pattern exists everywhere

Theme toggling is a solved problem in the frontend world. Every major design system that
supports dark/light mode (shadcn, Radix, Mantine, Chakra) uses a variation of this pattern.
The core insight: **CSS transitions are the enemy of instant theme swaps**. They were designed
for user-triggered interactions (hover, focus) where smooth animation is desirable. A whole-UI
palette inversion is the one case where you want zero animation — and the double RAF no-transition
trick is the standard surgical tool to achieve it.

---

## Phase 10 (2026-03-09): Event Trail + Session Strip + Dependency Tracking

### The Story

We added the three observability layers that complete the dashboard's purpose. The task table was
always showing you *what* agents were working on. Now it also shows you *how* they did it, *why*
something is blocked, and *what's happening at the session level* (outside of any task).

Think of it like upgrading from a call sheet (task list) to a full production report:
call sheet + shot-by-shot log + director's notes.

### New Architecture Layer: Three-Tier Observability

```
Session (orchestrator)          ← GlobalEventStrip (bottom panel)
  └─ Task (Agent tool call)     ← task table row
       └─ Events (tool calls)   ← EventTrailRow (expanded row)
```

### Feature 1: Event Trail (EventTrailRow)

When you expand a task row, instead of raw log text you now see a live sequence of every tool
call the agent made to accomplish the task:

```
💻 Bash    ls src/components/    completed   0.3s
📖 Read    src/types/task.ts     completed   0.1s
✏️ Edit    src/components/...    running      —
```

**How it works**:

- `pre-tool-all.sh` fires on ALL tools (empty matcher). Skips "Agent" calls (handled by the
  existing hook). Finds the running task for the current `session_id` via
  `GET /api/tasks?status=running&sessionId=X`, then appends a `HookEvent` to that task's
  `events[]` array via GET→mutate→PUT.
- `post-tool-all.sh` fires on PostToolUse and PostToolUseFailure. Finds the matching pre-event
  by `tool_use_id` and updates its `status` + `completedAt`.
- The UI priority: `events[]` > `children[]` > `logs[]`. If a task has event trail data, that
  takes precedence.

**The attribution design**: Tool events are attributed to tasks by `session_id`. Claude Code
passes `session_id` in every hook's stdin payload. The task stores it. The sub-tool hooks
query for the running task in that session. For single-agent use, this is unambiguous.

### Feature 2: Global Session Event Strip

A collapsible panel below the task table catches everything that doesn't belong to a task:
UserPromptSubmit, SessionStart, SubagentStart/Stop, Notification, PermissionRequest,
PreCompact, Stop.

```
SESSION EVENTS  (12)
💬 UserPromptSubmit   "Review the auth system"       14:32:00
🚀 SessionStart       claude-sonnet-4-6              14:32:01
🤖 SubagentStart      agent_abc123                   14:32:05
🔐 PermissionRequest  Bash: rm attempted, blocked    14:32:40
📦 PreCompact         context compaction triggered   14:33:01
🛑 Stop               session ended                  14:35:22
```

**How it works**: `session-event.sh --event-type TYPE` is a single script that handles all
session-level events. It reads type-specific fields from stdin and POSTs to
`/api/sessionEvents` (new top-level collection in `db.json`). `useTaskPolling` now fetches
both `/api/tasks` and `/api/sessionEvents` in parallel on each poll.

### Feature 3: Dependency Tracking + Blocked State

Tasks can declare dependencies using a `[dependsOn:ID1,ID2]` tag in their description —
same pattern as the existing `[parentId:XXX]` tag.

When the orchestrator agent creates a "Review Code" task, it can write:
`Review the codebase [parentId:task-abc] [dependsOn:build-task-id,test-task-id]`

The pre-hook strips both tags from the display name and stores `dependencies: ["build-task-id",
"test-task-id"]` on the task record.

**Client-side blocked computation** in `useTaskPolling`:

1. `computeBlockedState(tasks)` runs on the flat `tasks` array BEFORE `buildTree()`
2. For each task with `dependencies`, checks if any dep is not `completed/cancelled`
3. If blocking deps exist: sets `task.status = "blocked"` and `node.blockedBy = [ids]`
4. Tree inherits the updated status automatically

**Why before buildTree?** buildTree creates TaskNode objects by spreading Task fields
(`{ ...task, children: [] }`). If you ran blocked computation after, you'd need to traverse
the tree recursively to find and update each node. Running it on the flat array first is O(n)
and the tree just inherits the result.

**UI**: Status cell shows `[⊘ Blocked] / waiting for: Build, Run Tests` inline.
Color: orange-400 (distinct from amber's paused, red's failed).

### New Files

| File | Purpose |
|------|---------|
| `scripts/pre-tool-all.sh` | PreToolUse hook for all non-Agent tools → event trail |
| `scripts/post-tool-all.sh` | PostToolUse/Failure hook for all non-Agent tools |
| `scripts/session-event.sh` | Session-level hook (12 event types, `--event-type` arg) |

### Modified Files

| File | Change |
|------|--------|
| `src/types/task.ts` | Added `HookEvent`, `SessionEvent`, `SessionEventType`; `blocked` to `TaskStatus`; `events?`, `dependencies?`, `sessionId?` to `Task`; `blockedBy?` to `TaskNode` |
| `src/hooks/useTaskPolling.ts` | `computeBlockedState()`, `sessionEvents` state, parallel fetch |
| `src/components/TaskTable.tsx` | `EventTrailRow`, `GlobalEventStrip`, `blocked` in all status maps, `taskMap` for blocking name lookup, updated expanded row priority |
| `src/components/ui/badge.tsx` | Added `blocked` variant (orange) |
| `~/.claude/settings.json` | Added 10 new hook event types |
| `db.json` | Added `sessionEvents: []` collection |

### Director's Commentary: On Observability Layers

The mental model that made this design click: there are three questions you need to answer
about any agent run, and each question lives at a different layer:

1. **"What was this agent trying to do?"** → the task row
2. **"How did it try to do it?"** → the event trail (tool sequence)
3. **"What happened around it?"** → the session strip (lifecycle events)

Mixing these into a single view (one flat event stream, like disler's dashboard) gives you
completeness but loses context. Keeping them in layers gives you a zoom level:

- From 10,000 feet: scan the task table for status
- From 1,000 feet: expand a task to see its tool sequence
- At ground level: open the session strip to see lifecycle events

This three-layer design is the same reason video editors have the timeline, the clip view,
and the metadata inspector — same footage, different resolution of information.

## Code Review: Anti-Patterns Found and Fixed (2026-03-09)

### The Story

After implementing the observability features (Phase 10), a code review agent audited the
codebase and surfaced 7 issues — two critical, five important. All were fixed in the same
session. No features changed; this was a quality pass only.

---

### 🎬 Blooper 20: Shell Injection via Unquoted `$SESSION_ID` in curl URL

**Files:** `scripts/pre-tool-all.sh`, `scripts/post-tool-all.sh`

```bash
# The dangerous pattern:
RUNNING_TASK=$(curl -s "http://localhost:3001/tasks?status=running&sessionId=$SESSION_ID")
```

`SESSION_ID` was read directly from untrusted hook stdin and interpolated bare into a shell
string. Any value with `"`, `` ` ``, `$()`, or whitespace in it could execute arbitrary
shell commands. Hook payloads come from Claude Code internals, so this isn't an active
threat — but it's the kind of thing that could become one if the session ID format ever
changes or if the scripts are reused in a different context.

**The fix:** Sanitize immediately after extraction using `tr` to allowlist:

```bash
SESSION_ID=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
```

**The lesson:** Treat every external input as untrusted, even if it comes from a tool you
control. This is the same discipline as parameterized SQL queries — you don't trust the
input; you constrain it before it touches anything that executes.

---

### 🎬 Blooper 21: Mutating State Before Calling `setState`

**File:** `src/hooks/useTaskPolling.ts`

```typescript
// The dangerous pattern:
const data: Task[] = Array.isArray(rawTasks) ? rawTasks : [];
computeBlockedState(data);   // mutates task.status in-place on the raw array
setTasks(data);              // now sets state to the already-mutated object
```

`computeBlockedState` was designed to mutate tasks in-place (the comment even says so).
The problem: `data` is the raw JSON parse result. Mutating it and then passing it to
`setTasks` means React is holding a reference to the same object that was mutated. On the
next poll, React tries to compare old state to new state to decide whether to re-render —
but it's comparing the mutated object to itself. React bails out early, suppressing updates
that should have triggered a re-render.

This is one of the most common React mistakes: **state mutation**. React assumes state is
immutable. If you hand it a mutated reference, it can't detect the change.

**The fix:** Clone before mutating:

```typescript
const data: Task[] = Array.isArray(rawTasks)
  ? rawTasks.map((t: Task) => ({ ...t }))
  : [];
computeBlockedState(data);   // mutates clones, not the raw parse
```

The spread `{ ...t }` creates a new object for each task, so React gets a fresh reference
every poll cycle. This is a shallow clone — nested objects would still be shared — but
since `computeBlockedState` only touches top-level `status`, shallow is enough.

**The lesson:** The rule is simple — never mutate state directly. The subtlety is that
"state" includes anything you're about to hand to `setState`. The moment you call
`setTasks(data)`, `data` becomes state. So mutate before that line means you're
mutating state.

---

### 🎬 Blooper 22: `new Date()` Inside a Sort Comparator

**File:** `src/components/TaskTable.tsx` (the `sortNodes` function)

```typescript
// The flawed pattern — called O(n log n) times:
const aDur = a.startedAt
  ? new Date(a.completedAt || new Date()).getTime() - new Date(a.startedAt).getTime()
  : 0;
```

Sort comparators run once per comparison pair — O(n log n) calls for n tasks. Calling
`new Date()` (with no arguments, meaning "right now") inside the comparator means the
"current time" reference shifts slightly on every single call. Two running tasks with the
same elapsed time might sort differently on consecutive comparisons within the same sort
pass because the "now" keeps moving.

This creates non-deterministic sort order — running tasks could appear to jump positions
randomly when sorted by duration, even when nothing real changed.

**The fix:** Capture `now` once before the sort begins:

```typescript
function sortNodes(nodes: TaskNode[], sort: SortState): TaskNode[] {
  if (!sort.col) return nodes;
  const now = Date.now();             // ← captured once, stable for entire sort
  const sorted = [...nodes].sort((a, b) => {
    // ...
    const aDur = a.startedAt
      ? new Date(a.completedAt ?? now).getTime() - new Date(a.startedAt).getTime()
      : 0;
```

**The lesson:** Anything that changes over time — clocks, random numbers, external state
— should be captured before an algorithm that runs it multiple times. Think of it like a
camera take: you set the white balance once before you start rolling, not once per frame.

---

### 🎬 Blooper 23: Global Theme State Owned by a Child Component

**Files:** `src/components/TaskTable.tsx` → moved to `src/components/Dashboard.tsx`

```typescript
// The misplaced pattern — inside TaskTable, a display component:
const [lightMode, setLightMode] = useState(false);

useEffect(() => () => document.documentElement.classList.remove("light"), []);
```

`TaskTable` is a table renderer. It has no business owning global document state. The
`useEffect` cleanup removes the `"light"` class from `<html>` when `TaskTable` unmounts.
If `TaskTable` is ever conditionally rendered (error boundary, Suspense, route change),
the theme resets to dark unexpectedly — even though the user didn't ask for that.

The mental model: whoever "outlives" the state should own it. `TaskTable` can unmount.
`Dashboard` is always present while the app is running. So `Dashboard` is the right owner.

**The fix:** Lift the state up.

- Moved `lightMode` useState, `handleThemeToggle`, and the cleanup `useEffect` to
  `Dashboard.tsx`
- Added `lightMode: boolean` and `onThemeToggle: () => void` props to `TaskTableProps`
- `TaskTable` now receives these from above instead of managing them itself

**The lesson:** This is the canonical "lifting state up" pattern from the React docs. The
rule of thumb: if a piece of state affects something outside the component's rendered
output (like `document.documentElement`), it belongs at or above the level that contains
all affected components.

---

### 🎬 Blooper 24: `db.json` Missing the `sessionEvents` Collection

**File:** `db.json`

After implementing the Global Session Strip (Phase 10), session events were consistently
failing with HTTP 404. The hook logs showed:

```
[session] ERROR: POST /sessionEvents failed (HTTP 404) for UserPromptSubmit
```

The bug: `db.json` never had a `sessionEvents` key. json-server only exposes REST
endpoints for collections that exist in the file at startup. There is no auto-creation —
if the key isn't there when the server starts, the route doesn't exist.

The `post-tool-agent.sh` bootstrap was updated to include `sessionEvents` (Issue 5 from
the same review), but that fix only applies when `db.json` is recreated from scratch.
The existing file was never updated.

**The fix:** Add the key directly to the live file:

```json
{
  "tasks": [...],
  "sessionEvents": []
}
```

**The lesson:** When a script writes an initial schema ("if the file doesn't exist,
create it with X"), updating that script doesn't retroactively fix existing files. Always
check whether your "bootstrap" and your "current state" are in sync. This is the same
class of problem as a migration script that works on new installs but fails on upgrades.

---

### Director's Commentary: On Code Review as a Practice

The seven issues found in this review fit two categories:

**Boundary violations** — things that crossed a line they shouldn't:

- Shell injection: external data entering a URL without sanitization
- Theme state: global DOM side-effects owned by a display component
- Schema drift: a bootstrap script and a live file out of sync

**Temporal assumptions** — things that assumed time was frozen when it wasn't:

- State mutation: treating a mutable object as if it were an immutable snapshot
- Sort comparator: calling `new Date()` inside a loop where "now" must be constant

Both categories share a root cause: **implicit contracts**. The shell script implicitly
assumed `SESSION_ID` would be safe. The sort comparator implicitly assumed `new Date()`
would be stable. Explicit contracts — URL encoding, cloning before mutation, capturing
time before a loop — eliminate the ambiguity.

A senior engineer's instinct when reading code is to ask: "what does this implicitly
assume, and what happens when that assumption is wrong?" That question caught all seven
of these issues.

## Phase 11 Polish (2026-03-09): Scroll Behavior + Session Filter Upgrade

### Smart Scroll vs. Always-Scroll — Choosing the Right Default

Two scrollable containers were added in Phase 10: `EventTrailRow` (tool events inside an
expanded task) and `GlobalEventStrip` (the session event panel at the bottom).

The first implementation of `GlobalEventStrip` used "smart scroll" — only auto-follow if
you're within 60px of the bottom:

```typescript
const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
```

The pattern made sense in theory: if the user has scrolled up to read older events, don't
yank them back down. But in practice, the session strip is opened because you want to see
what's happening *now*. Opening it and immediately seeing old events is confusing.

**Final approach**: both `EventTrailRow` and `GlobalEventStrip` use unconditional scroll:

```typescript
el.scrollTop = el.scrollHeight;
```

**Senior Engineer Note:** The near-bottom smart-scroll pattern is the right default for
persistent logs (like a build output terminal) where users scroll up to investigate.
For ephemeral "live status" panels opened on demand, always-scroll is better — the user
just asked to see it, so show them the current state.

The dependency to use in `useEffect` is `events.length`, not the full `events` array.
Using `events` would re-run the scroll effect every time any event's `status` or
`completedAt` changes — causing janky scroll snaps on event updates. `events.length` only
fires when the count changes, which is when you actually want to scroll.

```typescript
// Correct — only fires when count changes
useEffect(() => { el.scrollTop = el.scrollHeight; }, [events.length, open]);

// Wrong — fires on every event mutation (status updates, timestamps)
useEffect(() => { el.scrollTop = el.scrollHeight; }, [events, open]);
```

---

## Pattern: Request Logging in HTTP Handlers (2026-03-23)

### The Concept

Every HTTP request has a signal chain:

```
REQUEST → PARSE INPUT → VALIDATE → QUERY DB → TRANSFORM → SEND RESPONSE
```

You need to know **three things** at each stage to debug production issues:

1. **What did the client ask for?** (request intent)
2. **What did the system find?** (database truth)
3. **What did we send back?** (response contract)

Without these markers, an error in production is a mystery. With them, you can trace the exact
path the request took and where it broke.

### The Pattern: Three Log Points

**Analogy:** Think of logging like the director's calls on a film set. "Action" is when something
starts, "cut" is when it ends. Between them, we mark the takes that matter:

```typescript
app.post('/endpoint', async (c) => {
  // Stage 1: PARSE INPUT
  let body;
  try {
    body = await c.req.json();
  } catch (error) {
    console.error('❌ Failed to parse JSON:', error.message);
    return c.json({ error: 'Bad request' }, 400);
  }

  // Stage 2: LOG THE REQUEST (the "slate")
  console.log('📩 POST /endpoint called with:', { key1: body.key1, key2: body.key2 });

  // Stage 3: VALIDATE INPUT (expected failures)
  if (!body.key1 || !body.key2) {
    console.error('❌ Missing required fields:', { hasKey1: !!body.key1, hasKey2: !!body.key2 });
    return c.json({ error: 'key1 and key2 required' }, 400);
  }

  // Stage 4: EXECUTE BUSINESS LOGIC (unexpected failures)
  try {
    console.log('🔄 Querying database for:', { key1: body.key1 });
    const result = await db.insert(...).values({...}).returning();

    console.log('✅ Success: created ID', result[0].id, 'with status', result[0].status);
    return c.json(result[0], 201);
  } catch (error) {
    console.error('❌ Database error:', error.message);
    return c.json({ error: 'Internal server error' }, 500);
  }
});
```

### Breaking Down the Three Zones

**Zone 1: Input Parsing (try/catch)**
- Wraps **async input** that might throw unexpectedly
- JSON parsing, headers, file reads — anything the client sends
- Log the error; return a 400 (bad request)

```typescript
try {
  body = await c.req.json();
} catch (error) {
  console.error('Malformed JSON:', error.message);
  return c.json({ error: 'Bad request' }, 400);
}
```

**Zone 2: Request Entry (console.log)**
- Logs the **intent** with minimal data loss
- Captured early, before any state changes
- Answer: "What did the client ask for?"

```typescript
console.log('POST /tasks called with:', { name: body.name, sessionId: body.sessionId });
```

**Zone 3: Validation (if/else)**
- Uses **conditions you expect** and can handle
- Missing fields, invalid enums, not found — normal error paths
- Log what's missing; return a 400

```typescript
if (!body.name || !body.sessionId) {
  console.error('Missing required:', { hasName: !!body.name, hasSessionId: !!body.sessionId });
  return c.json({ error: 'name and sessionId required' }, 400);
}
```

**Zone 4: Execution (try/catch + logging)**
- Wraps **business logic** that might fail unexpectedly
- Database queries, external APIs, file operations
- Log **before** (what you're about to do) and **after** (what you got)

```typescript
try {
  console.log('Inserting task:', { name: body.name, sessionId: body.sessionId });
  const result = await db.insert(tasksTable).values({...}).returning();

  console.log('Task inserted:', { id: result[0].id, status: result[0].status });
  return c.json(result[0], 201);
} catch (error) {
  console.error('Failed to insert task:', error.message);
  return c.json({ error: 'Database error' }, 500);
}
```

---

### Conceptual Foundation: The Three Stages

Before we look at real code, understand that **every request follows three stages**:

```
STAGE 1: EXTRACT/PARSE INPUT
(Get data from the request)
    ↓
STAGE 2: VALIDATE
(Check the data is usable)
    ↓
STAGE 3: QUERY/MODIFY DB
(Use the clean data)
```

**What happens at each stage:**

**Stage 1: Extract/Parse Input** — Get data from the request
- Extract query params: `c.req.query('sessionId')` → always a string (no try/catch needed)
- Parse JSON body: `c.req.json()` → might throw (try/catch needed)
- Extract URL params: `c.req.param('id')` → always a string (no try/catch needed)

**Stage 2: Validate** — Check the data exists and is in the right format
- Is the field present? `if (!sessionId) { return error }`
- Is it the right type? Check enums, formats, ranges
- Always use if/else — these are expected failures

**Stage 3: Query/Modify DB** — Use the clean data to access the database
- `await db.select().from(...).where(...)`
- Wrap in try/catch — database errors are unexpected

**Why this matters:** Each stage has a different purpose and different error handling. Mixing them up
is where bugs hide.

---

### Real Example: GET /sessionEvents (All Three Stages)

Here's how the three stages look in practice with your actual code:

```typescript
// GET /sessionEvents
app.get('/sessionEvents', async (c) => {
  // ─────── STAGE 1: EXTRACT ───────
  const sessionId = c.req.query('sessionId');  // ← Extract from URL (no try/catch)
  console.log('GET /sessionEvents called with:', sessionId);

  // ─────── STAGE 2: VALIDATE ───────
  if (!sessionId) {  // ← Validate it exists (if/else)
    console.error('Missing required sessionId:', { hasSessionId: !!sessionId });
    return c.json({ error: 'sessionId required' }, 400);
  }

  // ─────── STAGE 3: QUERY DB ───────
  try {  // ← Database operation (try/catch)
    const rows = sessionId
      ? await db
          .select()
          .from(sessionEventsTable)
          .where(eq(sessionEventsTable.sessionId, sessionId))
      : await db.select().from(sessionEventsTable);

    console.log('Query returned:', {
      rows: rows.length,
      id: rows[0]?.id,
      sessionId: rows[0]?.id,
    });

    return c.json(
      rows.map((e) => ({
        ...e,
        metadata: e.metadata ? JSON.parse(e.metadata) : undefined,
      })),
    );
  } catch (error) {  // ← Catch unexpected DB errors
    console.error('Query failed:', error.message);
    return c.json({ error: 'Database error' }, 500);
  }
});
```

**Notice:**
- **Stage 1** (extract): No try/catch. Query params are always strings.
- **Stage 2** (validate): if/else. You expect some requests to be missing sessionId.
- **Stage 3** (query): try/catch. Database errors are unexpected.

---

### Real Example: POST /tasks in server.ts

```typescript
// POST /tasks - called by pre-tool-agent.sh
app.post('/tasks', async (c) => {
  let body;

  // Zone 1: Parse
  try {
    body = await c.req.json();
  } catch (error) {
    console.error('Malformed JSON response', error);
    return c.json({ error: 'Bad request' }, 400);
  }

  // Zone 2: Log request
  console.log('POST /tasks called with:', { name: body.name, sessionId: body.sessionId });

  // Zone 3: Validate
  if (!body.name || !body.sessionId) {
    console.error('Missing required fields:', { hasName: !!body.name, hasSessionId: !!body.sessionId });
    return c.json({ error: 'name and sessionId required' }, 400);
  }

  // Zone 4: Execute
  try {
    console.log('Inserting task:', { name: body.name, sessionId: body.sessionId });
    const result = await db
      .insert(tasksTable)
      .values({
        id: crypto.randomUUID(),
        name: body.name,
        sessionId: body.sessionId,
        status: 'unassigned',
        createdAt: new Date().toISOString(),
      })
      .returning();

    console.log('Task inserted successfully:', { id: result[0].id, status: result[0].status });
    return c.json(result[0], 201);
  } catch (error) {
    console.error('Failed to insert task:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});
```

### When to Use console.log vs console.error

- **console.log** — Informational flow ("request came in", "query returned 5 rows", "response sent")
- **console.error** — Something went wrong ("validation failed", "database threw", "JSON unparseable")

In production with proper logging libraries (like Pino), these map to different levels (`info` vs
`error`), which let you filter and alert separately. For now, the distinction matters for clarity.

### The Lesson: Explicit Over Implicit

Without these logs, you have:
- A 500 error response, but no idea which code path was taken
- A database failure, but no way to know what the request was asking for

With them, you have a **breadcrumb trail**: "client asked for X, system checked Y, database did Z,
sent back response." That trail is the difference between "something broke" and "something broke
**here**, **because of that**, and **here's how to fix it**."

---

### Adapting the Pattern: GET vs POST vs PATCH vs DELETE

The four-zone pattern works for all HTTP methods, but what you log **changes** depending on the
operation. Use this memory hook: **"CRUD → Log the Boundaries"** — think of what **enters** and
what **exits**.

```
GET     → enters: filters/queries | exits: data        → log both
POST    → enters: body            | exits: new ID      → log both
PATCH   → enters: ID + body       | exits: updated     → log all three
DELETE  → enters: ID              | exits: deleted OK   → log both
```

#### GET Requests: Log the Filter, Log the Result

Query parameters don't need try/catch (they're always strings). Log what you're looking for and
what you found:

```typescript
app.get('/tasks', async (c) => {
  const status = c.req.query('status');
  const sessionId = c.req.query('sessionId');
  console.log('GET /tasks called with:', { status, sessionId });  // ← What you're looking for

  if (!status || !sessionId) {
    console.error('Missing required query:', { hasStatus: !!status, hasSessionId: !!sessionId });
    return c.json({ error: 'status and sessionId required' }, 400);
  }

  try {
    const rows = await db.select().from(tasksTable).where(...);
    console.log('Query returned:', rows.length, 'rows');  // ← What you found
    return c.json({ data: rows });
  } catch (error) {
    console.error('Query failed:', error.message);
    return c.json({ error: 'Database error' }, 500);
  }
});
```

#### POST Requests: Log the Body, Log the New ID

Full four-zone pattern — parse, log, validate, execute:

```typescript
app.post('/tasks', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch (error) {
    console.error('Malformed JSON:', error.message);
    return c.json({ error: 'Bad request' }, 400);
  }

  console.log('POST /tasks called with:', { name: body.name, sessionId: body.sessionId });

  if (!body.name || !body.sessionId) {
    console.error('Missing required fields:', { hasName: !!body.name, hasSessionId: !!body.sessionId });
    return c.json({ error: 'name and sessionId required' }, 400);
  }

  try {
    const result = await db.insert(tasksTable).values({...}).returning();
    console.log('Task created:', { id: result[0].id, status: result[0].status });
    return c.json(result[0], 201);
  } catch (error) {
    console.error('Failed to insert:', error.message);
    return c.json({ error: 'Database error' }, 500);
  }
});
```

#### PATCH Requests: Log ID, Log What's Changing, Log the Result

Update operations need three logs: which resource, what's changing, what resulted:

```typescript
app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  let body;

  try {
    body = await c.req.json();
  } catch (error) {
    console.error('Malformed JSON:', error.message);
    return c.json({ error: 'Bad request' }, 400);
  }

  console.log('PATCH /tasks/:id called:', { id, updating: Object.keys(body) });

  try {
    // Check if exists first
    const existing = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing.length) {
      console.error('Task not found:', id);
      return c.json({ error: 'task not found' }, 404);
    }

    // Then update
    console.log('Updating task:', { id, fields: Object.keys(body) });
    const result = await db.update(tasksTable).set(body).where(eq(tasksTable.id, id)).returning();

    console.log('Task updated:', { id, newStatus: result[0].status });
    return c.json(result[0]);
  } catch (error) {
    console.error('Failed to update task:', error.message);
    return c.json({ error: 'Database error' }, 500);
  }
});
```

#### DELETE Requests: Log the ID, Confirm It's Gone

No body to parse. Log what you're deleting and confirm it happened:

```typescript
app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');

  if (!id) {
    console.error('Missing ID param');
    return c.json({ error: 'id required' }, 400);
  }

  try {
    console.log('Deleting task:', id);
    const result = await db.delete(tasksTable).where(eq(tasksTable.id, id)).returning();

    if (!result.length) {
      console.error('Task not found for deletion:', id);
      return c.json({ error: 'task not found' }, 404);
    }

    console.log('Task deleted:', id);
    return c.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete task:', error.message);
    return c.json({ error: 'Database error' }, 500);
  }
});
```

---

### Quick Reference: HTTP Method Logging Cheat Sheet

| Method | Input Zone | Log Entry | Log Success |
|--------|-----------|-----------|-------------|
| **GET /list** | Query params | "called with filters X" | "found N rows" |
| **GET /:id** | URL param | "looking for ID X" | "found/not found" |
| **POST** | Parse body | "received body with keys X" | "created ID X with status Y" |
| **PATCH /:id** | Parse body + ID | "updating ID X with fields Y" | "updated, new status Z" |
| **DELETE /:id** | URL param | "deleting ID X" | "deleted / not found" |

**The pattern is always the same:** Log what enters, validate, execute with try/catch, log what
results. Only the **details** of what to log change based on what the HTTP method does.

---

### Senior Engineer Note: Why This Matters for Your Portfolio

When someone reviews your `server.ts`, they'll immediately see:
- Do you understand request/response contracts?
- Do you think about the common failure modes?
- Can you debug production issues later?

Good logging answers all three. It shows you're thinking like someone who has to support code at
2 AM when something breaks.

---

### Your Learning Path: Weak Points & Study Areas

You've implemented the logging pattern well. Here's what you struggled with and what to study next:

#### 1. **API Contract Definition** (Weakest Point)

**What you struggled with:** Identifying which fields are actually required for an endpoint. You
initially validated `name` for sessionEvents (a tasks field), then had to look at the schema and
hook script to figure out the real contract.

**What to study:**
- Before you write a handler, document what the client **will send** and what the server
  **guarantees to return**
- Create a simple interface or comment above each endpoint:
  ```typescript
  // POST /sessionEvents
  // Input: { sessionId: string, type: string, summary?: string, metadata?: object }
  // Output: { id: string, sessionId: string, type: string, ... }
  // Errors: 400 (missing sessionId/type), 500 (DB error)
  ```
- Read: REST API design best practices — understand how to think about requests/responses as a contract

#### 2. **HTTP Status Codes** (Moderate Point)

**What you struggled with:** You initially returned 400 (Bad Request) for database errors when
it should be 500 (Internal Server Error). The semantic difference matters:
- 4xx = Client's fault (bad input, not found, etc.)
- 5xx = Server's fault (database crashed, unexpected error, etc.)

**What to study:**
- HTTP status codes: 400, 404, 409, 500, 503 and when to use each
- The rule: if the client can fix it by changing their request, use 4xx. If the server has a
  problem, use 5xx.

#### 3. **Silent Failures** (Moderate Point)

**What you did right:** You caught this during review. You initially didn't log "task not found"
errors — they were silent returns.

**Why this matters:** If a client can't find a resource, that's a real failure state. Logging it
means you can later debug "why are clients getting 404s?" by checking the logs.

**What to study:** Every if/else that returns an error should have a corresponding
`console.error()` call. If you ever need to debug why users are getting errors, logs are your
only clue.

#### 4. **Input Validation vs Transformation** (Good Instinct, Needs Depth)

**What you got right:** You asked the question "do we need to transform or just validate?" This
is senior-level thinking.

**What to study deeper:**
- **Validation** = "Is this the right format and does it exist?"
- **Transformation** = "Convert this format into a different format (string → Date, snake_case
  → camelCase, etc.)"
- Most of your endpoints validate. Some will need transformation later (like date strings →
  Date objects). Know the difference.

#### 5. **Logging Specificity** (Good Overall, Minor Gaps)

**What you did well:** Most of your logs are specific. `console.log('Task inserted:', { id,
status })` tells you exactly what happened.

**What needs work:**
- Don't log entire objects: `console.error('Failed:', error)` — include `error.message` or
  `error.code`
- Log action + context: "Task not found" is less clear than "Task not found for deletion: abc123"

**What to study:** Structured logging — what fields matter for each decision point?

---

### Next Steps for Mastery

1. **Read:** REST API best practices guide (understand the contract pattern)
2. **Read:** HTTP status codes semantics (4xx vs 5xx, specific codes)
3. **Practice:** Write the "Input/Output" comments above every endpoint BEFORE you code it
4. **Practice:** For each error case, ask: "If I see this error in production logs, will I know
   what happened?" If the answer is no, add more context to the log.

**The Senior Engineer Question:** After you write a handler, imagine it's 2 AM, the app is
broken, and all you have is the logs. Can you trace exactly what the client sent, what the
server did, and where it failed? If yes, you're done. If no, add more logging.

---

### A Word on Growth

You learned this logging pattern in one session and applied it consistently across 8 endpoints.
That's solid progress. The weak points above aren't failures — they're just the next layer of
depth. Every senior engineer had to learn these distinctions.
