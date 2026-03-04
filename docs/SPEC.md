# Claude Agent Dashboard — Spec & Changelog

A concise record of what was built, what changed, and the current system contract.

---

## System Contract (as of 2026-03-04)

**Stack**: Bun · Vite 6 · React 19 · TypeScript · Tailwind v4 (CSS-first) · json-server

**Ports**:

- `5173` — Vite dev server (React UI)
- `3001` — json-server (REST API over `db.json`)
- `3002` — spawn-terminal server (AppleScript bridge for "New Agent" button)

**State**: `db.json` — flat JSON array of task records. Written by hook scripts, read by json-server, polled by React every 2.5s.

**Start**: `bun run dev` — starts all three servers via `concurrently`.

---

## Task Record Shape

```typescript
{
  id:                 string;        // tool_use_id from Claude Code
  name:               string;        // Agent tool `description` field
  status:             "running" | "completed" | "failed" | "cancelled" | "paused";
  agentType:          string;        // Agent tool `subagent_type` field
  parentId:           string | null; // for child tasks (not yet populated by hooks)
  createdAt:          string;        // ISO 8601
  startedAt:          string;        // ISO 8601
  completedAt:        string | null; // null while running
  progressPercentage: number;        // 0 or 100 (no intermediate steps yet)
  logs: Array<{
    timestamp: string;
    level:     "info" | "error";
    message:   string;
  }>;
}
```

---

## Changelog

### Phase 5 — Hook Integration (2026-03-04)

**Goal**: Replace mock data with live Claude Code agent events.

**Delivered**:

- `scripts/pre-tool-agent.sh` — PreToolUse hook; creates `running` task on agent start
- `scripts/post-tool-agent.sh` — PostToolUse hook; resolves task to `completed` / `failed`
- `~/.claude/settings.json` — global hook wiring (fires across all Claude Code sessions)
- Bootstrap guard: scripts recreate `db.json` if missing or structurally invalid
- Background task detection: tasks dispatched with `run_in_background: true` stay `running`
- Atomic writes: `jq ... > tmp && mv tmp db.json` prevents partial-read corruption

**How to verify**: Start `bun run dev`, invoke any Agent tool in Claude Code, check the dashboard within 2.5s.

---

### UI Redesign — shadcn Mira/Stone Table (2026-03-03)

**Goal**: Replace the dark-blue card tree view with a professional data table.

**Delivered**:

- `TaskTable.tsx` — sortable table with toolbar, inline log rows, tree expansion, row actions
- Stone dark OKLCH palette, Figtree font, Tabler icons, small-radius Mira style
- Toolbar: search, Status filter, Agent filter, bulk-select checkbox
- Per-row: `▶` expand children, `N LOGS` chip expand/collapse log panel, `⋮` action menu
- Log panel: terminal-style timestamp + level + message, copy button with checkmark feedback
- `Dashboard.tsx` reduced to a thin wrapper that mounts `<TaskTable>`

---

### UI Polish (2026-03-04)

- **Copy-log button** in log panel header — `IconCopy` → `IconCheck` with 1.5s reset, uses `navigator.clipboard.writeText`
- **`N LOGS` chip** — replaces terminal icon; monospace text highlights when panel is open
- **Log panel margin** — adjusted to `mx-[30px]` for tighter alignment with row content
- **"New Agent" button** (`scripts/spawn-terminal.ts`) — detects `$TERM_PROGRAM` and spawns `claude` via terminal-specific AppleScript:
  - **iTerm2**: `create window with default profile command "claude"` (native API)
  - **Terminal.app**: `do script "claude"` (native API)
  - **Ghostty / other**: activate → Cmd+N → keystroke `claude` → Enter (AppleScript)

---

## Known Limitations

| Limitation | Phase to address |
|-----------|-----------------|
| Background tasks stay `running` indefinitely | Phase 7 |
| `parentId` not populated by hooks (child tasks not linked) | Phase 7 |
| No per-session filtering (all historical tasks shown) | Phase 7 |
| No "clear completed" button | Phase 7 |
| Ghostty new-window delay requires a 0.5s sleep in AppleScript | Future polish |
