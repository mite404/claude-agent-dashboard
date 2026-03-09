# Claude Agent Dashboard — Spec & Changelog

A concise record of what was built, what changed, and the current system contract.

---

## System Contract (as of 2026-03-09)

**Stack**: Bun · Vite 6 · React 19 · TypeScript · Tailwind v4 (CSS-first) · json-server

**Ports**:

- `5173` — Vite dev server (React UI)
- `3001` — json-server (REST API over `db.json`)
- `3002` — spawn-terminal server (AppleScript bridge for "New Agent" button)

**State**: `db.json` — two flat JSON arrays: `tasks` and `sessionEvents`. Written by hook
scripts via REST, read by json-server, polled by React every 2.5s.

**Start**: `bun run dev` — starts all services via `concurrently`.

---

## Task Record Shape

```typescript
{
  id:                 string;        // tool_use_id from Claude Code
  name:               string;        // Agent tool `description` field (parentId/dependsOn tags stripped)
  status:             TaskStatus;    // see union below
  agentType:          string;        // Agent tool `subagent_type` field
  parentId:           string | null; // encoded via [parentId:XXX] tag in description
  sessionId?:         string;        // Claude Code session_id from hook stdin
  createdAt:          string;        // ISO 8601
  startedAt:          string;        // ISO 8601
  completedAt:        string | null; // null while running
  progressPercentage: number;        // 0 or 100
  logs:               LogEntry[];
  events?:            HookEvent[];   // per-tool events captured during execution
  dependencies?:      string[];      // task IDs this must wait for ([dependsOn:ID1,ID2] tag)
}

type TaskStatus =
  | "pending" | "running" | "completed"
  | "failed"  | "paused"  | "cancelled" | "blocked";

interface HookEvent {
  id:           string;            // tool_use_id
  toolName:     string;            // Bash, Read, Write, Edit, Grep, etc.
  phase:        "pre" | "post";
  status:       "running" | "completed" | "failed";
  summary:      string;            // first ~120 chars of tool_input
  timestamp:    string;
  completedAt?: string;
}
```

## Session Event Record Shape

```typescript
interface SessionEvent {
  id:           string;
  type:         SessionEventType;   // see union below
  timestamp:    string;
  sessionId:    string;
  summary:      string;
  model?:       string;             // from SessionStart
  tokenCount?:  number;             // from PreCompact
}

type SessionEventType =
  | "UserPromptSubmit" | "SessionStart"  | "Stop"
  | "SubagentStart"    | "SubagentStop"
  | "Notification"     | "PermissionRequest"
  | "PreCompact"       | "PostToolUseFailure";
```

---

## Changelog

### Phase 10 — Observability Overhaul (2026-03-09)

**Goal**: Three-tier agent observability: session → task → tool events.

**Delivered**:

- **Event Trail** (`EventTrailRow`) — expanded task rows now show a capped (240px), auto-scrolling
  sequence of every tool call the agent made: emoji · tool name · summary · status · duration
- **Global Session Strip** (`GlobalEventStrip`) — collapsible panel below the table showing
  lifecycle events (UserPromptSubmit, SessionStart, SubagentStart/Stop, Notification,
  PermissionRequest, PreCompact, Stop). Auto-scrolls to latest entry.
- **Dependency Tracking** — tasks can declare `[dependsOn:ID1,ID2]` in their description;
  `computeBlockedState()` runs client-side before `buildTree()` and overrides status to `blocked`;
  the status cell shows "waiting for: [task names]"
- **New hook scripts**: `pre-tool-all.sh` (appends pre-events to parent task),
  `post-tool-all.sh` (updates event status), `session-event.sh` (handles all 10 session
  event types via `--event-type TYPE` arg)
- **11 hook event types** now registered in `~/.claude/settings.json`
- **`db.json`** gains `sessionEvents: []` collection alongside `tasks`

### Code Quality Pass (2026-03-09)

- Shell injection: `$SESSION_ID` sanitized with `tr -cd 'a-zA-Z0-9_-'` in all hook scripts
- State mutation: raw fetch array shallow-cloned before `computeBlockedState()`
- `handleBulkDelete` now has a `catch` block (errors were silently swallowed)
- Log row keys changed from `key={i}` to `` key={`${entry.timestamp}-${i}`} ``
- `new Date()` in sort comparator replaced with `const now = Date.now()` captured once
- `lightMode` state and theme toggle lifted from `TaskTable` → `Dashboard`

### Session Filter Redesign (2026-03-09)

Replaced boolean timestamp-gate with a multi-select session popover. Each session is
labeled by the name of its earliest root-level task. The filter drives a `Set<string>` of
selected `sessionId` values; tasks without a `sessionId` are unaffected.

---

## Known Limitations

| Limitation | Status |
|-----------|--------|
| Background tasks stay `running` indefinitely | Accepted — hook fires on return only |
| Events attributed to sessions only — no per-agent attribution for parallel runs | Future |
| `[dependsOn:...]` requires orchestrator prompt engineering | By design |
| Ghostty new-window delay requires a 0.5s sleep in AppleScript | Future polish |
