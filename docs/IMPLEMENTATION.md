# Claude Agent Dashboard - Implementation Plan

## Overview

A real-time web dashboard for tracking Claude Code subagent task execution. The dashboard polls
json-server (backed by `db.json`) every 2.5 seconds and displays task status, relationships, logs,
and control buttons (cancel/pause/retry).

**Tech Stack**: Bun + Vite 6 + React 19 + Tailwind v4 + Radix UI + json-server

---

## Current Status (as of 2026-03-04)

### ✅ Completed

- **Project initialized** — Vite + React 19 + TypeScript 5.7
- **Tailwind v4** configured via `@tailwindcss/vite` plugin (CSS-first, no `tailwind.config.ts`)
- **Dependencies installed** — Radix UI (accordion, slot), lucide-react, class-variance-authority,
  json-server, concurrently, vite-tsconfig-paths
- **TypeScript** — tsconfig.app.json + tsconfig.node.json project references, `@/*` path alias
  working via `vite-tsconfig-paths`
- **All React components built**:
  - `Dashboard.tsx` — main container, stats strip, polling state
  - `TaskTree.tsx` — recursive parent/child hierarchy with connector lines
  - `TaskCard.tsx` — status badge, progress bar, elapsed time, accent bar
  - `LogViewer.tsx` — Radix Accordion, terminal-style log table (line numbers, timestamps, levels)
  - `ControlButtons.tsx` — Cancel/Pause/Retry via PATCH to json-server
  - `ui/button.tsx`, `ui/badge.tsx`, `ui/progress.tsx` — custom shadcn-style primitives
- **Bun server** — replaced by Vite dev server + json-server combo
- **json-server** — serves `db.json` as REST API on port 3001
- **Vite proxy** — `/api/*` → `http://localhost:3001/*` (no CORS needed)
- **Mock data** — `db.json` has 6 realistic tasks with parent/child relationships, logs,
  varied statuses
- **Vite watcher** — `db.json` excluded from HMR (`server.watch.ignored`) so json-server writes
  don't trigger page reloads
- **Docs** — `docs/API.md`, `docs/HOOK.md`, `docs/FOR_ETHAN.md`
- **Phase 5 — Claude Code Hook Integration** ✅
  - `scripts/pre-tool-agent.sh` — PreToolUse hook; creates `running` task on agent start
  - `scripts/post-tool-agent.sh` — PostToolUse hook; marks `completed` / `failed` on finish
  - `~/.claude/settings.json` — global hook wiring for both hooks on the `Agent` tool
  - Bootstrap guard: recreates `db.json` if missing or if `.tasks` key is absent/null
  - Atomic writes via `jq ... > file.tmp && mv file.tmp file`
  - Verified live: tasks appear in dashboard within 2.5s of Agent tool use
- **UI Polish (2026-03-04)**
  - Copy-log button with `IconCopy` → `IconCheck` 1.5s feedback in log panel header
  - Log count chip: `N LOGS` monospace text (replaces terminal icon in Name cell)
  - Log panel margin tuned to `mx-[30px]` (was `mx-10`)
- **New Agent button** (`scripts/spawn-terminal.ts`) — detects `$TERM_PROGRAM` and uses
  terminal-specific AppleScript to open a new window and run `claude`

---

## Phase 5 (✅ Completed 2026-03-04): Claude Code Hook Integration

### 5.1 Hook scripts

Two bash scripts in `scripts/` handle the full task lifecycle:

| Script | Hook type | What it does |
|--------|-----------|--------------|
| `scripts/pre-tool-agent.sh` | `PreToolUse` | Creates a `running` task record in `db.json` when an Agent tool call starts |
| `scripts/post-tool-agent.sh` | `PostToolUse` | Updates the task to `completed` / `failed` (or keeps `running` for background tasks) when the call ends |

Both scripts:

- Read JSON from stdin (`INPUT=$(cat)`)
- Use `tool_use_id` as the stable task ID linking pre and post calls
- Write atomically via `jq ... > db.json.tmp && mv db.json.tmp db.json`
- Bootstrap `db.json` if it doesn't exist or if `.tasks` is missing/null

### 5.2 Global hook wiring (`~/.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Agent", "hooks": [{ "type": "command", "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/pre-tool-agent.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "Agent", "hooks": [{ "type": "command", "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/post-tool-agent.sh" }] }
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

## Phase 7: Testing & Validation

- [x] Restart dev server after vite-tsconfig-paths fix and confirm no import errors
- [x] Confirm Cancel/Pause/Retry buttons PATCH correctly without page flash
- [x] Confirm polling updates status without full reload
- [x] Wire up hook and run a real parallel agent task to confirm live data flows through
- [ ] Confirm `parentId` relationships render correctly in TaskTree (child task support not yet
  exercised with live hook data)
- [x] Run RAMS accessibility audit and verify all critical/serious issues are fixed

---

## Phase 8: Polish & Iteration Ideas

- [ ] Add a "Clear completed" button to remove finished tasks from db.json
- [ ] Add a timestamp filter (only show tasks from current session)
- [ ] Add task duration column to a sortable table view (alternative to card view)
- [ ] Auto-scroll logs to bottom when new entries arrive
- [ ] Animate new tasks appearing (fade in)
- [ ] Dark/light mode toggle (the `@theme` CSS vars make this easy)
- [ ] **Skill attribution tracking** — Track which skill spawned each agent,
  with source classification

  **Why**: Distinguish between Anthropic built-in skills, Vercel agents.sh, custom skills, and
  community contributions. Useful for debugging and understanding agent execution chains,
  especially when experimenting with new skills.

  **Implementation**:

  1. Update `src/types/task.ts` — extend `TaskNode` interface:

     ```typescript
     interface TaskNode {
       // ... existing fields
       originatingSkill?: {
         name: string                                    // "review-pr", "audit-security"
         source: "anthropic" | "vercel" | "custom" | "community"
         author?: string                                 // skill creator
         experimental?: boolean                          // flag for new/testing skills
       }
     }
     ```

  2. Update hook script (`scripts/update-tasks.sh`) — capture skill metadata when creating tasks.
     The hook should extract:
     - Skill name/path from the environment or Claude Code context
     - Source classification (can be hardcoded initially, made configurable later)
     - Author from YAML frontmatter in the skill file

  3. Update `TaskTable.tsx` — add filter dropdown for skill source (similar to Agent filter):

     ```tsx
     <FilterPopover
       label="Skill Source"
       options={['anthropic', 'vercel', 'custom', 'community']}
       selected={skillSourceFilter}
       onToggle={toggleSkillSourceFilter}
       onClear={() => setSkillSourceFilter(new Set())}
     />
     ```

  4. **UI option**: Show skill name + source badge in a new "Skill" column, or as a tooltip on
     the task row for compact display.

  **Benefit**: When testing a new `/my-new-skill`, you can filter to see all tasks it spawned,
  track success rate, and compare against established Anthropic skills doing similar work.

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
