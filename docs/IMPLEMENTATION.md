# Claude Agent Dashboard - Implementation Plan

## Overview

A real-time web dashboard for tracking Claude Code subagent task execution. The dashboard polls
a Hono REST API (backed by SQLite via Drizzle ORM) every 2.5 seconds and displays task status,
relationships, logs, and control buttons (cancel/pause/retry).

**Tech Stack**: Bun + Vite 6 + React 19 + Tailwind v4 + Radix UI + Hono + SQLite + Drizzle ORM

> **Architecture pivot (PR #26):** json-server + `db.json` replaced by Hono (`src/server.ts`) +
> SQLite (`data/dashboard.db`). The `bun run server` script now runs Hono, not json-server.

---

## TODOs (Backlog)

- [ ] **Hook scripts don't capture the current Claude Code session ID.** All tasks created in the
  current session are being tagged with the session ID from yesterday. The hook scripts need to
  get the persistent Claude Code session ID (the one used to resume a conversation with full chat
  history) from an environment variable or state file that Claude Code sets on session start.
  This session ID should be used consistently across all tasks created during that session so
  that: (1) tasks can be linked to their corresponding chat history, (2) the session filter in
  the dashboard works correctly, and (3) tasks can be shared/referenced externally. This is a
  data plumbing issue — the dashboard logic is correct, but the source data is wrong.

- [ ] **`HookEvent` table is missing from the schema.** `pre-tool-all.sh` and `post-tool-all.sh`
  embed `events: [HookEvent]` in their PATCH bodies, but `server.ts` strips the `events` field
  before every Drizzle UPDATE (`const { logs, events, ... } = body`). The scripts were written
  against the old json-server API that stored events as embedded arrays in `db.json`. With
  SQLite, there is no `hook_events` table — the data is silently dropped on every write. A
  `hookEventsTable` needs to be added to `src/db/schema.ts` and the POST/PATCH handlers need to
  insert rows into it.

- [ ] **`EventTrailRow` will always be empty until the above is fixed.** The tool event timeline
  per task (`EventTrailRow` in `TaskTable.tsx` ~line 283) reads `task.events` to render the
  timeline of Bash/Read/Write calls. Because HookEvents are stripped at the server before they
  reach SQLite, `task.events` is always `undefined` and the row renders nothing. Fix depends on
  adding the `hookEventsTable` and updating `GET /tasks` (or a separate `GET /tasks/:id/events`
  endpoint) to return the events alongside the task.

---

## Current Status (as of 2026-03-26)

### ✅ Completed

- **Project initialized** — Vite + React 19 + TypeScript 5.7
- **Tailwind v4** configured via `@tailwindcss/vite` plugin (CSS-first, no `tailwind.config.ts`)
- **Dependencies installed** — Radix UI (accordion, slot), @tabler/icons-react, class-variance-authority,
  concurrently, vite-tsconfig-paths, hono, drizzle-orm, drizzle-kit, better-sqlite3
- **TypeScript** — tsconfig.app.json + tsconfig.node.json project references, `@/*` path alias
  working via `vite-tsconfig-paths`
- **All React components built**:
  - `Dashboard.tsx` — main container, stats strip, polling state
  - `TaskTable.tsx` — shadcn-mira table with sortable columns, row selection, actions
  - `GlobalEventStrip.tsx` — session events panel with "Clear all" button
  - `LogViewer.tsx` — Radix Accordion, terminal-style log table (line numbers, timestamps, levels)
  - `ui/button.tsx`, `ui/badge.tsx`, `ui/progress.tsx` — custom shadcn-style primitives
- **Hono server** — `src/server.ts` handles GET/POST/PATCH/DELETE for tasks and session events
- **SQLite database** — `data/dashboard.db` persists tasks, logs, and session events
- **Vite proxy** — `/api/*` → `http://localhost:3001/*` (no CORS needed)
- **Docs** — `docs/API.md`, `docs/HOOK.md`, `docs/FOR_ETHAN.md`
- **Phase 5 — Claude Code Hook Integration** ✅ (rewritten 2026-03-08)
  - `scripts/pre-tool-agent.sh` — PreToolUse hook; creates `running` task via REST API
  - `scripts/post-tool-agent.sh` — PostToolUse hook; GET→mutate→PUT to update status + logs
  - `~/.claude/settings.json` — global hook wiring for both hooks on the `Agent` tool
  - Bootstrap guard retained as pre-flight check (ensures `db.json` valid for server restarts)
  - **Hooks now use `curl` against json-server REST API** — no more direct `jq` file writes
  - Hook observability: `logs/hooks.log` + `tail -F` as 4th `concurrently` process in `dev`
  - Defensive parse in `useTaskPolling`: `Array.isArray(raw) ? raw : []` guards `buildTree`
- **UI Polish (2026-03-04)**
  - Copy-log button with `IconCopy` → `IconCheck` 1.5s feedback in log panel header
  - Log count chip: `N LOGS` monospace text (replaces terminal icon in Name cell)
  - Log panel margin tuned to `mx-[30px]` (was `mx-10`)
- **New Agent button** (`scripts/spawn-terminal.ts`) — detects `$TERM_PROGRAM` and uses
  terminal-specific AppleScript to open a new window and run `claude`
- **PR #26 — SQLite Migration** ✅ (2026-03-26)
  - `json-server` + `db.json` replaced by **Hono** (`src/server.ts`) + **SQLite**
    (`data/dashboard.db`) via **Drizzle ORM**
  - `src/db/schema.ts` — Drizzle schema (sessions, tasks, logs, session_events, task_dependencies,
    schema_version tables)
  - `src/db/index.ts` — Drizzle client with `casing: 'snake_case'` + WAL pragmas
  - `drizzle.config.ts` — must match `casing: 'snake_case'` to stay in sync with ORM
  - `scripts/migrate-to-sqlite.ts` — one-time migration from `db.json` → SQLite
  - `bun run dev` now runs: Vite + `PORT=3001 bun --watch src/server.ts` + hooks + terminal
  - GET `/tasks` + GET `/sessionEvents` support **optional** filters — no params returns all rows

---

## Phase 5 (✅ Completed 2026-03-04): Claude Code Hook Integration

### 5.1 Hook scripts

Two bash scripts in `scripts/` handle the full task lifecycle:

| Script | Hook type | What it does |
|--------|-----------|--------------|
| `scripts/pre-tool-agent.sh` | `PreToolUse` | Creates a `running` task record via POST to Hono API when an Agent tool call starts |
| `scripts/post-tool-agent.sh` | `PostToolUse` | Updates the task via PATCH when the call ends (status, logs, elapsed time) |

Both scripts:

- Read JSON from stdin (`INPUT=$(cat)`)
- Use `tool_use_id` as the stable task ID linking pre and post calls
- Talk to Hono server via `curl` (REST API) — all writes go through `src/server.ts` endpoints
- Log every API call result to `logs/hooks.log` with timestamp + `[pre-hook]`/`[post-hook]` label

**Why REST API instead of direct file writes?** Hono + SQLite use Drizzle ORM with type-safe
queries and proper transactions. Bypassing the API (e.g., direct SQL or file manipulation) breaks
schema validation, foreign keys, and migrations. All state changes must flow through the REST
endpoints.

**PATCH vs PUT:** Hono's PATCH endpoint in `src/server.ts` uses Drizzle's `.update().set()` to
do shallow merges — only the provided fields are updated. This is more efficient than
GET → mutate → PUT and matches REST semantics.

### 5.2 Global hook wiring (`~/.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Agent", "hooks": [
        { "type": "command", "command": "…/scripts/pre-tool-agent.sh" }
      ]}
    ],
    "PostToolUse": [
      { "matcher": "Agent", "hooks": [
        { "type": "command", "command": "…/scripts/post-tool-agent.sh" }
      ]}
    ]
  }
}
```

Wired globally (not project-level) so the dashboard monitors all Claude Code sessions.

---

## Phase 6 (✅ Completed 2026-03-04): RAMS Accessibility Audit & Fixes

A comprehensive WCAG 2.1 accessibility review using the RAMS design review process identified
12 issues across 3 severity levels. All issues fixed via targeted a11y improvements.

### 6.1 Audit Findings

| Severity | Count | Examples |
|----------|-------|----------|
| Critical | 4 | Icon-only buttons without `aria-label`, inputs without accessible names |
| Serious | 4 | Clickable rows without keyboard handlers, touch targets <44px, missing focus rings |
| Moderate | 4 | Decorative icons not `aria-hidden`, contrast ratios <4.5:1, missing live regions |

**Score: 57/100 → 95/100** after fixes.

### 6.2 Fixes Implemented

**A11y Attributes:**

- ✅ `aria-label` on all icon-only buttons (Copy Logs, Expand/Collapse, Action dots)
- ✅ `aria-label="Filter tasks"` on search input
- ✅ `aria-expanded` on expandable rows and tree toggles
- ✅ `aria-hidden="true"` on all decorative icons (status icons, search icon, terminal icon)
- ✅ `role="progressbar"` + `aria-valuenow/min/max` on progress bar
- ✅ `aria-live="polite"` region in Dashboard for polling announcements

**Keyboard & Focus:**

- ✅ `onKeyDown` handler on clickable `<TableRow>` for Enter/Space keys
- ✅ `tabIndex={0}` on focusable rows
- ✅ `focus-visible:ring-1 focus-visible:ring-stone-500` on all bare `<button>` elements

**Touch Targets (WCAG 2.5.5):**

- ✅ Expand/collapse button: `p-2 -m-2` (visual 20px, tappable 36px via invisible padding trick)
- ✅ Action dots button: `h-6 w-6` → `h-8 w-8` (24px → 32px)

**Semantic Colors & Contrast:**

- ✅ `STATUS_TEXT` colors now semantic: running→`slate-400`, failed→`red-500`,
  paused→`amber-400`
- ✅ `STATUS_ICON` colors match their text (decorative, but consistent and colored)
- ✅ Muted text bumped: `text-stone-600` → `text-stone-500` (footer, timestamps, log counts,
  parent IDs)
- ✅ LOGS badge: `text-stone-600` → `text-stone-500` when inactive
- ✅ All color changes contrast ≥4.5:1 on stone-950 background

**Files Changed:**

- `src/components/TaskTable.tsx` — STATUS_ICON/STATUS_TEXT colors, a11y attributes, touch targets,
  focus rings
- `src/components/Dashboard.tsx` — `aria-hidden` on IconActivity, `aria-live` region,
  subtitle text color
- Both files: minor text color bumps for contrast

### 6.3 Key Learning: Accessibility is Architecture

Accessibility isn't a cosmetic add-on; it's a design constraint. The fixes were straightforward
(1-liners mostly) once discovered, but they required intentional decisions:

- Icon-only buttons **must** have `aria-label`
- Clickable non-semantic elements (rows) **must** have keyboard handlers + `tabIndex`
- Decorative icons **must** be `aria-hidden` (otherwise screen readers announce them)
- Touch targets should be ≥44px **or** use invisible padding to expand the zone
- Semantic colors (running=blue, failed=red) aren't "extra" — they're the interface working
  as designed

All fixes documented in `docs/FOR_ETHAN.md` under "Director's Commentary: On Accessibility
as a Design Constraint."

---

## Phase 7 (✅ Completed 2026-03-07): Checkpoint View + Column Reorder

Goal: replace raw log expansion with a structured sub-task checklist, and restructure
columns for project-management clarity rather than debugging convenience.

### 7.1 Column Changes

| Before | After |
|--------|-------|
| Checkbox · ID · Task · Status · Agent · Progress · Duration · Actions | Checkbox · Task · Agent · Status · Subtasks · Progress · Duration · Actions |

- **ID column removed** from display (field still exists in data for backend use)
- **Subtasks column added** — shows `done/total` count (e.g. `2/5`) derived from
  `task.children`. Shows `—` for leaf tasks. Togglable via the View menu.
- **Column order** resequenced so agent context (Agent, Status, Subtasks) comes
  immediately after the task name
- **"N LOGS" pill** removed from the Task name cell — the Subtasks column communicates
  expandability without a separate indicator

### 7.2 CheckpointRow Component

When a task row is clicked to expand, the detail panel now shows:

- **Parent task has children** → `CheckpointRow` — a structured checklist of sub-tasks
- **Leaf task with logs** → `LogDetailRow` — existing log viewer (unchanged)
- **Leaf task with neither** → nothing (expand toggle hidden via `hasDetail` guard)

`CheckpointRow` layout per sub-task:

```
[status icon]  [task name]  [StatusBadge]  [elapsed time]
    ✓          Fetch docs    done           14s
    ●          Parse table   in progress    2m 3s
    ○          Generate...   pending        —
```

Status icons: `✓` completed · `●` running · `○` pending · `◐` paused · `✗` failed · `–` cancelled

Colors match existing semantic palette: green-400 / blue-400 / stone-600 / amber-400 / red-400.

### 7.3 Data Model (No Schema Changes)

`TaskNode.children[]` was already built client-side from `parentId` in `useTaskPolling.ts`.
The checkpoint view simply renders that existing array — no new API fields, no schema changes needed.

### 7.4 Files Changed

| File | Change |
|------|--------|
| `src/components/TaskTable.tsx` | Added `CheckpointRow`, updated column order/types, removed ID cell and LOGS pill, updated `hasDetail` guard |
| `docs/FOR_ETHAN.md` | Learning log entry added |
| `status-rail-mockup.html` | Deleted (was a concept prototype, now obsolete) |

---

## Phase 8: Testing & Validation

- [x] Restart dev server after vite-tsconfig-paths fix and confirm no import errors
- [x] Confirm Cancel/Pause/Retry buttons PATCH correctly without page flash
- [x] Confirm polling updates status without full reload
- [x] Wire up hook and run a real parallel agent task to confirm live data flows through
- [ ] Confirm `parentId` relationships render correctly in TaskTree (child task support not yet
  exercised with live hook data)
- [x] Run RAMS accessibility audit and verify all critical/serious issues are fixed

---

## Phase 9 (✅ Completed 2026-03-08): Hook Pipeline Rewrite + Observability

### Root cause: hooks were writing to the wrong layer

The original hooks wrote to `db.json` directly using `jq`. json-server loads `db.json` into
memory at startup and serves its in-memory copy — file writes after boot are invisible to the
API. The dashboard polled `GET /api/tasks` and always got the startup state.

Confirmed with: `curl -s http://localhost:3001/tasks | jq 'length'` → `0` (despite 4 tasks in
`db.json`).

### Fix: REST API instead of file writes

| Hook | Old approach | New approach |
|------|-------------|-------------|
| `pre-tool-agent.sh` | `jq ... > db.json.tmp && mv` | `curl -X POST /tasks` |
| `post-tool-agent.sh` | `jq ... > db.json.tmp && mv` | `curl GET` + mutate + `curl -X PUT` |

POST for pre-hook (create). GET→mutate→PUT for post-hook because json-server `PATCH` is shallow
merge — it would overwrite `logs[]` instead of appending. Full GET + PUT preserves the array.

### Bootstrap retained as pre-flight check

The `if [ ! -f "$DB_FILE" ]...` guard is kept in both scripts. It no longer writes tasks —
it ensures `db.json` is valid JSON with a `tasks` key so json-server can restart cleanly if
killed while the hooks are still firing.

### Defensive parse in useTaskPolling

```typescript
// Before — crashes if API returns null or {}
const data: Task[] = await res.json();

// After — empty table is worse than a crash, but better than a blank screen
const raw = await res.json();
const data: Task[] = Array.isArray(raw) ? raw : [];
```

`buildTree` uses `for...of` internally — it throws `TypeError: not iterable` on non-arrays.
The guard ensures worst case is an empty table, not a full app crash.

### Hook observability: logs/hooks.log

Each hook now logs every API call outcome to `logs/hooks.log`:

```
[03:59:01] [pre-hook] OK: created task toolu_01X ("Explore codebase", Explore)
[04:00:12] [post-hook] OK: updated task toolu_01X → completed
[04:01:00] [pre-hook] ERROR: POST /tasks failed (HTTP 000) — is json-server running on :3001?
```

`tail -F logs/hooks.log` runs as a 4th process in `concurrently` (labelled `[hooks]`), so hook
output streams live in the same terminal as Vite and json-server logs.

### Files Changed

| File | Change |
|------|--------|
| `scripts/pre-tool-agent.sh` | Rewrote to use `curl POST`; added `log()` function |
| `scripts/post-tool-agent.sh` | Rewrote to use `curl GET/PUT`; added `log()` function |
| `src/hooks/useTaskPolling.ts` | `Array.isArray` guard before `buildTree` |
| `package.json` | Added `--names` + `tail -F logs/hooks.log` to `dev` script |
| `logs/.gitkeep` | New — tracks `logs/` directory without committing log contents |
| `.gitignore` | Changed `logs` → `logs/*.log` (keep dir, ignore contents) |

---

## Phase 8: Polish & Iteration (✅ Completed 2026-03-08)

- [x] Add a "Clear completed" button — deletes completed/cancelled tasks via parallel
  `Promise.all(ids.map(deleteTask))`. Button styled `bg-rose-500 hover:bg-rose-400` (rose, not
  red) for good contrast on both dark and light backgrounds.
- [x] **Session filter** — redesigned as a multi-select popover (matching Status/Agent filter
  style). Each option is labeled by the name of the earliest root-level task for that `sessionId`.
  Filter drives `Set<string>` of selected IDs; tasks without `sessionId` pass through unaffected.
- [x] Duration column — already existed from the table redesign (skipped)
- [x] Auto-scroll logs to bottom — smart scroll: only auto-follows when the viewport is within
  60px of the bottom. Manually scrolling up to read earlier entries is never interrupted.
- [x] Animate new tasks appearing — 220ms `rowFadeIn` slide-down keyframe. `knownIds` ref
  tracks all seen IDs (no re-renders); `newIds` state drives the animation class for 250ms.
- [x] Dark/light mode toggle — **full stone scale inversion** via `:root.light` in
  `src/index.css`. All `--color-stone-X` CSS variables are overridden (stone-950 → white,
  stone-50 → near-black warm). Because Tailwind v4 generates stone utility classes as
  `var(--color-stone-X)` references, this flips the entire UI with zero component changes.
  - shadcn/ui orange accent: `oklch(0.702 0.185 48)` as `--color-accent`; warm cream surfaces
    (`oklch(0.963 0.008 92)`) matching the shadcn Tasks example page.
  - Orange focus ring in light mode via `--tw-ring-color: var(--color-accent)` on
    `:root.light input:focus-visible`.
  - Theme toggle flash fixed: synchronous DOM class toggle in click handler +
    `.no-transition` CSS kill switch + double `requestAnimationFrame` to remove it after the
    new-theme frame is painted (single RAF fires before paint — insufficient).
  - Table header hover state removed — header row no longer responds to hover in either theme.
- [x] Increase log window from `max-h-64` → `max-h-96` (256px → 384px, ~17 visible rows)
- [x] **Skill attribution tracking — Phase 1 (v1 MVP)** (✅ Completed 2026-03-10)

  **Implemented**: Simple skill name tracking via `/skill-name` regex in `UserPromptSubmit` hook.

  ```typescript
  // src/types/task.ts
  export interface SessionEvent {
    originatingSkill?: string // e.g. "/review-pr"
  }

  export interface Task {
    originatingSkill?: string // skill that spawned this task's session
  }
  ```

  **How it works**:
  1. `session-event.sh` detects `/skill-name` pattern from the prompt
  2. Stores as `{ originatingSkill: "/skill-name" }` in the session event
  3. `pre-tool-agent.sh` carries `originatingSkill` through to the task record
  4. Dashboard stores the skill name for task attribution

  **v2 Future enhancements** (not yet implemented):
  - Source classification (anthropic | vercel | custom | community)
  - Skill source UI filter (checkbox popover matching Status/Agent style)
  - Author + experimental flag tracking

---

## Phase 10 (✅ Completed 2026-03-09): Event Trail + Session Strip + Dependency Tracking

Three-tier observability: every agent run now exposes session events, task events, and
blocked state — at three zoom levels.

### 10.1 New Types (`src/types/task.ts`)

```typescript
// Added to TaskStatus union:
"blocked"

// New fields on Task:
sessionId?:    string       // Claude Code session_id (used to attribute tool events)
events?:       HookEvent[]  // ordered list of tool calls made during this task
dependencies?: string[]     // IDs of tasks this must wait for

// New field on TaskNode:
blockedBy?: string[]        // computed client-side — IDs of incomplete dependencies

// New types:
HookEvent       // { id, toolName, phase, status, summary, timestamp, completedAt? }
SessionEvent    // { id, type, timestamp, sessionId, summary, model?, tokenCount? }
SessionEventType // 9-value union (UserPromptSubmit | SessionStart | Stop | ...)
```

### 10.2 New Hook Scripts

| Script | Trigger | What it does |
|--------|---------|--------------|
| `scripts/pre-tool-all.sh` | `PreToolUse` (empty matcher) | Finds running task by `sessionId`, appends `HookEvent` (phase: "pre") |
| `scripts/post-tool-all.sh` | `PostToolUse` + `PostToolUseFailure` | Updates matching event to completed/failed |
| `scripts/session-event.sh` | 9 session-level event types | POSTs to `/api/sessionEvents` |

All three skip `Agent`/`Task` tool calls (handled by the existing Agent-matched hooks).
`SESSION_ID` is sanitized with `tr -cd 'a-zA-Z0-9_-'` before URL interpolation.

### 10.3 Blocked State Computation (`src/hooks/useTaskPolling.ts`)

```typescript
// computeBlockedState runs BEFORE buildTree so tree inherits updated statuses
computeBlockedState(data);   // mutates status → "blocked" on tasks with incomplete deps
setTasks(data);
setTree(buildTree(data));
```

`computeBlockedState` is O(n): builds a `Map`, then iterates tasks once. Must run before
`buildTree` because tree nodes spread from flat tasks — mutations after the spread are lost.

### 10.4 UI Components (`src/components/TaskTable.tsx`)

**`EventTrailRow`** — replaces expanded row when `task.events?.length > 0`:

```
💻  Bash    ls src/components/       completed   0.3s
📖  Read    src/types/task.ts        completed   0.1s
✍️  Write   src/components/New…      running      —
```

Capped at `max-h-[240px] overflow-y-auto`. Auto-scrolls to bottom on every new event
(`el.scrollTop = el.scrollHeight` — unconditional, not near-bottom-gated).

Expanded row priority: **events → CheckpointRow (children) → LogDetailRow (logs)**

**`GlobalEventStrip`** — collapsible panel below the table footer:

```
▶  SESSION EVENTS  (12)
💬  UserPromptSubmit   "Review the auth system"   14:32:00
🚀  SessionStart       claude-sonnet-4-6           14:32:01
🔐  PermissionRequest  Bash requested              14:32:40
```

Auto-scrolls to bottom on new events or panel open. Always-scroll (no smart-follow).

### 10.5 Dependency Tag Syntax

Orchestrator agents encode dependencies in the task description:

```
[parentId:PARENT_ID] [dependsOn:ID1,ID2] Actual task name here
```

`pre-tool-agent.sh` strips both tags before storing `name`, stores `parentId` and
`dependencies` as separate fields. Client-side `computeBlockedState` reads `dependencies`
to derive `blockedBy` and override `status` to `"blocked"`.

### 10.6 Files Changed

| File | Change |
|------|--------|
| `src/types/task.ts` | Added `HookEvent`, `SessionEvent`, `SessionEventType`; `blocked` status; new Task fields |
| `src/hooks/useTaskPolling.ts` | `computeBlockedState()`, `sessionEvents` state + fetch |
| `src/components/TaskTable.tsx` | `EventTrailRow`, `GlobalEventStrip`, blocked status UI, session filter popover |
| `src/components/Dashboard.tsx` | `sessionEvents` prop passed to `TaskTable`; `lightMode` state moved here |
| `src/components/ui/badge.tsx` | `blocked` variant (orange) |
| `scripts/pre-tool-agent.sh` | `sessionId` extraction; `[dependsOn:...]` tag parsing |
| `scripts/post-tool-agent.sh` | `sessionId` carry-through to PUT |
| `scripts/pre-tool-all.sh` | **New** |
| `scripts/post-tool-all.sh` | **New** |
| `scripts/session-event.sh` | **New** |
| `db.json` | Added `"sessionEvents": []` top-level collection |
| `~/.claude/settings.json` | 11 hook event types registered |

---

## Phase 11 (✅ Completed 2026-03-09): Security Hardening + UX Polish

---

## Phase 12 (✅ Completed 2026-03-10): Hook Expansion + Testing

**See also**: `docs/HOOK_EXPANSION.md` — detailed reference for all 18 Claude Code event types.

This phase expanded hook coverage from 12 to 18 Claude Code event types, implemented skill
attribution tracking (v1), fixed agent ID cross-referencing, and added component tests.

### 12.1 Hook Expansion (18/18 events covered)

Extended `session-event.sh` with 7 new case branches:

| Event | Summary | Fields captured |
|-------|---------|-----------------|
| `SessionEnd` | Session exit | `.reason` |
| `TeammateIdle` | Agent went idle | `.agent_id` |
| `TaskCompleted` | Task finished | `.task_title`, `.task_id` |
| `InstructionsLoaded` | CLAUDE.md loaded | `.file_path`, `.source` |
| `ConfigChange` | settings.json changed | `.file_path`, `.source` |
| `WorktreeCreate` | Worktree created | `.branch` |
| `WorktreeRemove` | Worktree cleaned | `.branch` |

All 18 events now post to `sessionEvents` collection with proper payload parsing.

### 12.2 Skill Attribution (v1)

`UserPromptSubmit` hook detects `/skill-name` pattern and stores `originatingSkill` string
in both `SessionEvent` and task records. Enables filtering/tracking of skill-driven task chains.

### 12.3 Agent ID Cross-Reference Fix

**Problem**: Task table showed `toolu_*` (tool use ID) while session events showed short hex
(agent ID) — two different IDs, confusing.

**Solution**: `SubagentStart` hook now PATCHes the task record with the real `.agent_id`:

1. `pre-tool-agent.sh` writes `TASK_ID` to temp file `/tmp/cc-agent-task-$SAFE_SID`
2. `session-event.sh` (SubagentStart) reads that file; falls back to json-server query if empty
3. PATCHes `{ agentId: <hex-agent-id> }` onto the task
4. Task table Agent ID column now matches session event agent IDs

### 12.4 Component Testing

- `GlobalEventStrip` component tests added
- Verified SESSION_EVENT_EMOJI map exhaustiveness via TypeScript Record type
- All 18 event types have emoji + label support

### 12.5 Files Changed

| File | Change |
|------|--------|
| `scripts/session-event.sh` | 7 new `case` branches; SubagentStart temp-file + PATCH logic |
| `src/types/task.ts` | SessionEventType union extended; 5 new optional fields on SessionEvent |
| `src/components/TaskTable.tsx` | SESSION_EVENT_EMOJI exhaustive Record; 7 new emoji entries |
| `~/.claude/settings.json` | 7 new hook registrations (all routed to `session-event.sh --event-type <EventName>`) |
| `src/hooks/useTaskPolling.ts` | (no changes — existing poll loop picks up new sessionEvents automatically) |

---

## Phase 11 (✅ Completed 2026-03-09): Security Hardening + UX Polish

### 11.1 Security & Quality Fixes

| Issue | Fix |
|-------|-----|
| `$SESSION_ID` bare in curl URL | `tr -cd 'a-zA-Z0-9_-'` sanitization in all hook scripts |
| Raw fetch array mutated before `setState` | `rawTasks.map(t => ({ ...t }))` — clone first |
| `handleBulkDelete` swallowed errors silently | Added `catch (err) { console.error(...) }` |
| Log row `key={i}` on append-only list | Changed to `` key={`${entry.timestamp}-${i}`} `` |
| `new Date()` in sort comparator (non-deterministic) | `const now = Date.now()` before sort |
| `lightMode` state + DOM mutation in `TaskTable` | Lifted to `Dashboard.tsx` |
| `db.json` missing `sessionEvents` key | Added directly; both bootstrap scripts aligned |

### 11.2 Session Filter Upgrade

The boolean toggle (`sessionStart = useRef(new Date())` timestamp gate) was replaced with
a proper multi-select popover. Session options are derived from unique `sessionId` values,
labeled by the name of the earliest root-level task per session.

```typescript
// State: boolean → Set<string>
const [sessionFilter, setSessionFilter] = useState<Set<string>>(new Set());

// sessionOptions: one entry per unique sessionId
const sessionOptions = useMemo(() => {
  // groups tasks by sessionId, labels each by earliest root task's name
  ...
}, [tree]);

// Filter predicate
if (sessionFilter.size > 0 && task.sessionId && !sessionFilter.has(task.sessionId))
  return false;
```

---

## Running the Project

```bash
# Install
bun install

# Start both servers
bun run dev
# → Vite UI at http://localhost:5173
# → json-server at http://localhost:3001

# json-server only (if you want to test the API separately)
bun run server
```

---

## UI Redesign — shadcn Mira/Stone Table (2026-03-03)

Replaced the dark-blue card tree view with a shadcn-style Tasks table using the Mira preset
(stone palette, Figtree font, small radius, Tabler icons).

### Files Changed

| File | Change |
|---|---|
| `index.html` | Figtree Google Font (preconnect + stylesheet) |
| `src/index.css` | Stone dark OKLCH palette, Figtree as `--font-sans`, keyframe animations |
| `ui/table.tsx` | shadcn-style table primitives (`Table`, `TableRow`, `TableHead`, `TableCell`, etc.) |
| `ui/input.tsx` | Search input with stone border/focus ring |
| `ui/checkbox.tsx` | Radix checkbox with indeterminate state (for "select all") |
| `ui/separator.tsx` | Thin stone-800 divider |
| `ui/popover.tsx` | Radix popover wrapper (used by filter dropdowns) |
| `ui/dropdown-menu.tsx` | Radix dropdown wrapper (used by row action ⋮ menu) |
| `ui/badge.tsx` | Stone-themed status badges with colored borders |
| `ui/button.tsx` | Stone-themed buttons (default, secondary, ghost, outline, destructive) |
| `TaskTable.tsx` | The entire new table: toolbar + sortable headers + inline log detail rows |
| `Dashboard.tsx` | Thin shell — now just mounts `<TaskTable>` |

### New Packages

| Package | Purpose |
|---|---|
| `@tabler/icons-react` | Tabler icon set (replaces lucide-react) |
| `@radix-ui/react-dropdown-menu` | Row action ⋮ menu |
| `@radix-ui/react-checkbox` | Row selection with indeterminate state |
| `@radix-ui/react-popover` | Filter dropdown panels |
| `@radix-ui/react-separator` | Divider primitive |

### Key Interactions in TaskTable

- **`▶` toggle** in Name cell → expands/collapses child task rows (tree stays intact,
  rows shift down)
- **`N LOGS` chip** in Name cell → expands/collapses an inline log detail row (`<tr colSpan={8}>`)
  below that task; chip uses monospace font and highlights when the panel is open
- **Status column header** → click cycles sort: `default → asc → desc → default`
  with arrow icons
- **Status / Agent filters** → Popover with checkboxes; count badge appears on button when active
- **`⋮` actions** → Dropdown per row: Pause/Resume (label is context-aware), Retry, Cancel

### Preserved (not deleted)

`TaskCard.tsx`, `TaskTree.tsx`, `ControlButtons.tsx`, `LogViewer.tsx`, `progress.tsx` — kept
for reference, no longer rendered.

---

## Phase 13 (✅ Completed 2026-03-26): SQLite Migration + Server Fixes

### 13.1 Data Migration (`scripts/migrate-to-sqlite.ts`)

Migrated existing data from `db.json` (json-server flat file) to the SQLite database
(`data/dashboard.db`) via Drizzle ORM. The migration script:

- Reads `db.json` with `Bun.file('./db.json').json()`
- Checks if data already exists before migrating (all-or-nothing safety check)
- Generates placeholder sessions from unique `sessionId` values found in tasks (since `db.json`
  has no `sessions` collection, but `tasksTable` has a foreign key to `sessionsTable`)
- Inserts tasks directly with `??` null guards for nullable fields
- Destructures each session event to separate schema columns (`id`, `sessionId`, `type`, etc.)
  from extra fields (`...rest`), storing extras in `metadata` as `JSON.stringify(rest)`
- Uses `.onConflictDoNothing()` on session events to skip duplicate IDs in source data

### 13.2 Bug: `casing` mismatch between drizzle-kit and drizzle ORM

**Root cause:** `src/db/index.ts` instantiated Drizzle with `casing: 'snake_case'`, which tells
the ORM to convert camelCase TypeScript keys to `snake_case` SQL column names at query time.
But `drizzle.config.ts` did not have this option, so `drizzle-kit push` created columns in
camelCase (e.g. `parentSessionId`). The ORM then queried for `parent_session_id`, which didn't
exist.

**Fix:** Added `casing: 'snake_case'` to `drizzle.config.ts` so both tools agree on column
naming. Deleted and recreated the database to apply clean snake_case schema.

### 13.3 Bug: GET /tasks and GET /sessionEvents returning 400 for all frontend polls

**Root cause:** The Hono server's `GET /tasks` handler required **both** `status` and `sessionId`
as query params on every request, returning 400 if either was missing. The frontend's
`useTaskPolling` hook polls `/api/tasks` with no filters — it fetches all tasks to build the
tree client-side.

Similarly, `GET /sessionEvents` required `sessionId` even though the handler already had logic
to return all rows when no `sessionId` was provided. The guard clause fired before reaching
that logic.

**Fix for `GET /tasks`:** Made both `status` and `sessionId` optional query params. Filters
are only applied when provided:

```typescript
const conditions = [];
if (status) conditions.push(eq(tasksTable.status, status));
if (sessionId) conditions.push(eq(tasksTable.sessionId, sessionId));

const rows = await db
  .select()
  .from(tasksTable)
  .where(conditions.length ? and(...conditions) : undefined);
```

**Fix for `GET /sessionEvents`:** Removed the early 400 return. The existing fallback logic
(`sessionId ? filter : return all`) now runs on every request.

**Why this matters:** The server was designed for filtered queries (like a search endpoint),
but the dashboard needs a "give me everything" poll to build the task tree. REST endpoints
used for polling must support unfiltered requests.

## Hono REST API Reference (`src/server.ts`)

### Endpoint Map

| Method | Route | Caller | Purpose |
|--------|-------|--------|---------|
| GET | `/tasks` | Frontend poll | All tasks, optional `?status=` `?sessionId=` filters |
| GET | `/tasks/:id` | Frontend detail | Single task by ID |
| POST | `/tasks` | `pre-tool-agent.sh` | Create task when Agent tool fires |
| PATCH | `/tasks/:id` | `post-tool-agent.sh` | Update status/logs after tool completes |
| DELETE | `/tasks/:id` | Frontend actions | Remove a task |
| GET | `/sessionEvents` | Frontend poll | All events, optional `?sessionId=` filter |
| POST | `/sessionEvents` | `session-event.sh` | Record a Claude Code lifecycle event |
| GET | `/debug/sessions` | Dev only | Inspect sessions table |

### Pattern 1 — Optional Filter with Dynamic Conditions

Used in `GET /tasks`. Builds a `WHERE` clause only from params that were actually sent:

```typescript
const conditions = [];
if (status) conditions.push(eq(tasksTable.status, status));
if (sessionId) conditions.push(eq(tasksTable.sessionId, sessionId));

const rows = await db
  .select()
  .from(tasksTable)
  .where(conditions.length ? and(...conditions) : undefined);
```

No params → returns all rows. Partial params → filters only what's provided. This is what
the frontend's 2.5s poll uses — no filters, full dataset, tree built client-side.

### Pattern 2 — Three-Zone Error Handling (Parse → Validate → Execute)

Every mutating endpoint follows the same structure:

```typescript
// Zone 1: parse (catch malformed JSON)
let body;
try { body = await c.req.json(); }
catch { return c.json({ error: 'Bad request' }, 400); }

// Zone 2: validate (catch missing required fields)
if (!body.name || !body.sessionId) {
  return c.json({ error: 'name and sessionId required' }, 400);
}

// Zone 3: execute (catch DB errors)
try {
  const result = await db.insert(tasksTable).values({ ... }).returning();
  return c.json(result[0], 201);
} catch (error) {
  return c.json({ error: 'Database error' }, 500);
}
```

### Pattern 3 — Metadata Round-Trip (Stringify on Write, Parse on Read)

`sessionEventsTable.metadata` is `text({ mode: 'json' })`. Extra event fields (toolName, error,
tokenCount, etc.) are stored as a JSON string and parsed back on GET:

```typescript
// POST: stored as stringified JSON
metadata: body.metadata || null

// GET: parsed back to object before returning to frontend
return c.json(
  rows.map((e) => ({
    ...e,
    metadata: e.metadata ? JSON.parse(e.metadata as string) : undefined,
  }))
);
```

### Pattern 4 — `RETURNING` Clause (Get Back What You Just Wrote)

Drizzle's `.returning()` tells SQLite to return the inserted/updated row immediately —
no need for a second SELECT query:

```typescript
const result = await db.insert(tasksTable).values({ ... }).returning();
return c.json(result[0], 201); // result is an array; [0] is the new row
```

---

## Key Architectural Decisions

1. **Vite** over Bun's built-in server — better plugin ecosystem, mature HMR
2. **json-server** over a custom Bun server — zero-code REST API from a flat file
3. **File-based state (`db.json`)** over in-memory — survives server restarts,
   hookable by shell scripts
4. **Polling** over WebSockets — simpler for a single-user local tool; 2.5s lag is imperceptible
5. **Tailwind v4** CSS-first `@theme {}` — no JS config, tokens are CSS variables
   usable everywhere
6. **vite-tsconfig-paths** — single source of truth for `@/` alias
   (reads tsconfig, no duplication)
7. **Radix UI primitives** — accessible accordion for logs, slot for polymorphic Button component
8. **Hono** over json-server for the API layer — json-server has no custom logic; Hono lets us
   write typed handlers, input validation, and proper error codes while staying lightweight
9. **SQLite + Drizzle** over `db.json` — relational constraints (foreign keys), type-safe queries,
   and schema versioning. `data/dashboard.db` is gitignored; run `bunx drizzle-kit push` to
   initialize. Always set `casing: 'snake_case'` in both `drizzle.config.ts` and `drizzle()` call
10. **`casing: 'snake_case'` must be set in two places** — `drizzle.config.ts` (schema push) AND
    `src/db/index.ts` (ORM queries). Mismatch causes `SQLITE_CANTOPEN` / column-not-found errors
