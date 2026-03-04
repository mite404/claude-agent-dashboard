# Claude Agent Dashboard - Implementation Plan

## Overview

A real-time web dashboard for tracking Claude Code subagent task execution. The dashboard polls json-server (backed by `db.json`) every 2.5 seconds and displays task status, relationships, logs, and control buttons (cancel/pause/retry).

**Tech Stack**: Bun + Vite 6 + React 19 + Tailwind v4 + Radix UI + json-server

---

## Current Status (as of 2026-03-03)

### ✅ Completed

- **Project initialized** — Vite + React 19 + TypeScript 5.7
- **Tailwind v4** configured via `@tailwindcss/vite` plugin (CSS-first, no `tailwind.config.ts`)
- **Dependencies installed** — Radix UI (accordion, slot), lucide-react, class-variance-authority, json-server, concurrently, vite-tsconfig-paths
- **TypeScript** — tsconfig.app.json + tsconfig.node.json project references, `@/*` path alias working via `vite-tsconfig-paths`
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
- **Mock data** — `db.json` has 6 realistic tasks with parent/child relationships, logs, varied statuses
- **Vite watcher** — `db.json` excluded from HMR (`server.watch.ignored`) so json-server writes don't trigger page reloads
- **Docs** — `docs/API.md`, `docs/HOOK.md`, `docs/FOR_ETHAN.md`

### 🔄 In Progress / Known Issues

- `@/` alias path resolution was failing; fixed with `vite-tsconfig-paths` — **requires a full `bun run dev` restart to take effect**
- Hook integration is documented but not yet connected to a live Claude Code session

### ⏳ Remaining Work

---

## Phase 5 (Remaining): Claude Code Hook Integration

### 5.1 Create the hook shell script

**File**: `scripts/update-tasks.sh`

The script reads stdin from the Claude Code hook (JSON with tool_use_id, tool_input, tool_result), builds a Task object, and upserts it into `db.json` using `jq`.

See `docs/HOOK.md` for the full script and instructions.

### 5.2 Wire up the hook in Claude Code settings

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-agent-dashboard/scripts/update-tasks.sh"
          }
        ]
      }
    ]
  }
}
```

### 5.3 Add a PreToolUse hook for "running" state

The current hook only fires *after* a task completes. Add a `PreToolUse` hook on the Agent tool to mark tasks as `running` when they start — so the dashboard shows them mid-flight, not just when they finish.

---

## Phase 6: Testing & Validation

- [ ] Restart dev server after vite-tsconfig-paths fix and confirm no import errors
- [ ] Confirm Cancel/Pause/Retry buttons PATCH correctly without page flash
- [ ] Confirm polling updates status without full reload
- [ ] Wire up hook and run a real parallel agent task to confirm live data flows through
- [ ] Confirm `parentId` relationships render correctly in TaskTree

---

## Phase 7: Polish & Iteration Ideas

- [ ] Add a "Clear completed" button to remove finished tasks from db.json
- [ ] Add a timestamp filter (only show tasks from current session)
- [ ] Add task duration column to a sortable table view (alternative to card view)
- [ ] Auto-scroll logs to bottom when new entries arrive
- [ ] Animate new tasks appearing (fade in)
- [ ] Dark/light mode toggle (the `@theme` CSS vars make this easy)
- [ ] **Skill attribution tracking** — Track which skill spawned each agent, with source classification

  **Why**: Distinguish between Anthropic built-in skills, Vercel agents.sh, custom skills, and community contributions. Useful for debugging and understanding agent execution chains, especially when experimenting with new skills.

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

  2. Update hook script (`scripts/update-tasks.sh`) — capture skill metadata when creating tasks. The hook should extract:
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

  4. **UI option**: Show skill name + source badge in a new "Skill" column, or as a tooltip on the task row for compact display.

  **Benefit**: When testing a new `/my-new-skill`, you can filter to see all tasks it spawned, track success rate, and compare against established Anthropic skills doing similar work.

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

Replaced the dark-blue card tree view with a shadcn-style Tasks table using the Mira preset (stone palette, Figtree font, small radius, Tabler icons).

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

- **`▶` toggle** in Name cell → expands/collapses child task rows (tree stays intact, rows shift down)
- **Terminal icon + count** in Name cell → expands/collapses an inline log detail row (`<tr colSpan={8}>`) below that task
- **Status column header** → click cycles sort: `default → asc → desc → default` with arrow icons
- **Status / Agent filters** → Popover with checkboxes; count badge appears on button when active
- **`⋮` actions** → Dropdown per row: Pause/Resume (label is context-aware), Retry, Cancel

### Preserved (not deleted)

`TaskCard.tsx`, `TaskTree.tsx`, `ControlButtons.tsx`, `LogViewer.tsx`, `progress.tsx` — kept for reference, no longer rendered.

---

## Key Architectural Decisions

1. **Vite** over Bun's built-in server — better plugin ecosystem, mature HMR
2. **json-server** over a custom Bun server — zero-code REST API from a flat file
3. **File-based state (`db.json`)** over in-memory — survives server restarts, hookable by shell scripts
4. **Polling** over WebSockets — simpler for a single-user local tool; 2.5s lag is imperceptible
5. **Tailwind v4** CSS-first `@theme {}` — no JS config, tokens are CSS variables usable everywhere
6. **vite-tsconfig-paths** — single source of truth for `@/` alias (reads tsconfig, no duplication)
7. **Radix UI primitives** — accessible accordion for logs, slot for polymorphic Button component
