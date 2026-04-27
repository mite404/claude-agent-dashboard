# Scripts Overview: The Hook-Based Telemetry Pipeline

## What This Is

The `scripts/` directory implements a **hook-based telemetry system** that intercepts Claude
Code's tool execution and session lifecycle, logging every event to SQLite. Think of it like
a film production's shot-logging system: every time Claude Code picks up a tool (like the
camera), these scripts record metadata (who, what, when, where) and stream it to the database.

The dashboard frontend then polls the database and renders tasks + events in real time.

## Signal Flow Diagram

```
Claude Code Session Lifecycle
         │
         ├─ SessionStart ──────────────┐
         │                              │
         ├─ UserPromptSubmit (detects /skill-name)
         │                              │
         ├─ Agent tool called ─────────┼─ pre-tool-agent.ts
         │  (PreToolUse)               │  creates Task record
         │                              │
         ├─ Regular tools called ──────┼─ pre-tool-all.ts
         │  (Read, Bash, etc.)         │  logs HookEvent (phase='pre')
         │                              │
         ├─ Tools complete ────────────┼─ post-tool-all.ts
         │  (PostToolUse)              │  updates HookEvent (phase='post')
         │                              │
         ├─ Subagent finishes ────────┼─ session-event.sh
         │  (SubagentStop)             │  marks Task complete
         │                              │
    ┌────▼────────────────────────────┴─────────────────┐
    │ All events flow through                            │
    │ session-event.sh (for SessionEvents)               │
    │ or hook handlers (for HookEvents)                  │
    └─────────────────────────────────────────────────────┘
                      │
              PATCH /tasks/{id}
              POST /sessionEvents
                      │
              SQLite Database
                      │
    ┌─────────────────┴──────────────────┐
    │                                    │
Vite polls /api/tasks (2.5s interval)   │
    │                                    │
React renders TaskTable + events        │
```

## Script Directory

### Hook Handlers (Intercept Claude Code Events)

#### `pre-tool-all.ts` — Log ALL Non-Agent Tool Calls (Pre-Phase)

**Trigger:** Claude Code `PreToolUse` hook (matches: Bash, Read, Write, Edit, Grep, Glob,
WebFetch, WebSearch — everything except Agent/Task tools)

**What it does:**
- Parses stdin JSON: `session_id`, `tool_name`, `tool_use_id`, `tool_input`
- Looks up the running task in SQLite by `sessionId` or `agentId`
- Extracts a summary of tool input (first 120 chars of relevant field: command, file path,
  query, etc.)
- Creates a `HookEvent` record with `phase='pre'`, `status='running'`
- Appends it to the task's `events` array

**API Calls:**
```
GET /tasks?sessionId={sessionId}        # Find running task
PATCH /tasks/{taskId}                   # Append HookEvent
```

**Example:** When Claude Code calls `Read src/server.ts`, this script logs:
```json
{
  "tool": "Read",
  "phase": "pre",
  "status": "running",
  "input_summary": "src/server.ts"
}
```

---

#### `post-tool-all.ts` — Log ALL Non-Agent Tool Calls (Post-Phase)

**Trigger:** Claude Code `PostToolUse` or `PostToolUseFailure` hooks

**What it does:**
- Parses stdin: `tool_use_id`, tool response (success/error)
- Finds the matching `HookEvent` from pre-phase by `tool_use_id`
- Updates it: `phase='post'`, `status='completed'` or `'failed'`, adds `completedAt` timestamp
- Writes entire updated `events` array back to the task

**API Calls:**
```
GET /tasks?sessionId={sessionId}        # Find running task
PATCH /tasks/{taskId}                   # Update HookEvent
```

**Status Logic:** If response has `is_error: true` → `'failed'`, else → `'completed'`

---

#### `pre-tool-agent.ts` — Create Task Record When Subagent Starts

**Trigger:** Claude Code `PreToolUse` hook with `Agent` tool matcher

**What it does:**
- Parses stdin: `tool_use_id` (becomes `taskId`), `tool_input.description` (task name),
  `tool_input.subagent_type` (e.g., `code-reviewer`, `Explore`)
- **Metadata extraction:** Parses task description for inline tags:
  - `[parentId:abc123]` — link to parent task
  - `[dependsOn:xyz,def]` — array of blocking task IDs
  - `[kind:work|evaluation|planning]` — task category
- **Skill attribution:** Reads `/tmp/cc-skill-{sessionId}` to capture if task was spawned by a
  skill (e.g., `/code-review`)
- **Creates new Task:** status='running', progressPercentage=0, createdAt/startedAt set
- **Writes temp file:** `/tmp/cc-agent-task-{sessionId}` for child agents to link to parent

**API Calls:**
```
POST /tasks                             # Create task record
```

**Temp File Coordination:**
- **Reads:** `/tmp/cc-skill-{sessionId}` (written by session-event.sh on UserPromptSubmit)
- **Writes:** `/tmp/cc-agent-task-{sessionId}` (read by session-event.sh on SubagentStart)

---

#### `post-tool-agent.ts` — Mark Subagent Task Complete

**Trigger:** Claude Code `PostToolUse` hook with `Agent` tool matcher

**Status:** ⚠️ **Currently incomplete** (1-line file with undefined variable reference)

**What it should do:** Mirror `post-tool-all.ts` but for Agent tool completion (mark task
as completed/failed).

---

### Session-Level Event Handler

#### `session-event.sh` — Capture All 14+ Session Lifecycle Events

**Trigger:** Claude Code session-level hooks via `--event-type` parameter:
- `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`
- `Notification`, `PermissionRequest`, `PreCompact`, `PostToolUseFailure`
- (and 6 others)

**What it does:**
- Parses stdin JSON from hook
- **Event-specific extraction:**
  - `UserPromptSubmit` → detects `/skill-name` pattern, writes to `/tmp/cc-skill-{sessionId}`
  - `SubagentStart` → reads `/tmp/cc-agent-task-{sessionId}` to find parent task, writes
    `/tmp/cc-agentid-{agentId}` as fallback
  - `SubagentStop` → marks parent task as completed (status='completed',
    progressPercentage=100)
  - `SessionStart` → captures model name
  - `Notification`, `PermissionRequest` → captures tool name, message
  - `PreCompact` → captures token count for context compression
- **Retry logic:** Exponential backoff (100ms → 200ms → 400ms, 3 attempts) for HTTP resilience
- **Creates SessionEvent:** Merges standard fields + event-specific metadata JSON

**API Calls:**
```
POST /sessionEvents                     # Create session event (with retry)
GET /tasks?sessionId={sessionId}        # Lookup parent task for SubagentStart/Stop
PATCH /tasks/{parentTaskId}             # Link agentId or mark as completed
```

**Race Condition Handling:** Uses dual lookup for SubagentStart:
1. Check `/tmp/cc-agent-task-{sessionId}` (temp file)
2. Fall back to API query if file doesn't exist yet

---

### Manual & Utility Scripts

#### `post-task.ts` — Create Task via CLI

**Trigger:** Manual invocation from shell or external scripts

**CLI Signature:**
```bash
bun scripts/post-task.ts <name> <description> <sessionId> [priority]
```

**What it does:**
- Accepts task name, description, sessionId, optional priority (low|normal|high|urgent,
  defaults to 'normal')
- Falls back to `CLAUDE_SESSION_ID` env var if sessionId not provided
- POSTs to `/tasks` with `agentType='manual'`, `status='unassigned'`
- Returns taskId via stdout for shell capture

**Use case:** Create ad-hoc tasks from external tools or batch workflows

**Status:** ⚠️ **Has bug:** taskId incorrectly extracted from ReadableStream response (should
parse JSON body first)

---

#### `smoke-test.sh` — End-to-End Signal Chain Validation

**Trigger:** `bun run smoke` (manual test)

**What it does:** Tests 5 critical steps:
1. json-server responding on `:3001`
2. Vite proxy responding on `:5173`
3. Pre-hook creates task with status='running' and logs
4. Post-hook updates task to 'completed' and appends log
5. Task visible through Vite proxy

**Exit Behavior:** Cleans up test task on EXIT trap (success or failure)

**Success Criteria:** All 5 steps pass = signal chain is healthy

---

#### `spawn-terminal.ts` — Spawn CLI Session from Dashboard

**What it does:**
- Listens on port 3002
- Accepts POST `/spawn` requests from dashboard UI
- Detects terminal type (iTerm2, Warp, Ghostty)
- Builds AppleScript (iTerm2) or keyboard automation script (others)
- Returns terminal type in response

**CORS:** Allows requests from `http://localhost:5173` (Vite dev server)

**Use case:** "Open Terminal" button in dashboard

---

#### `migrate-to-sqlite.ts` — One-Time Data Migration

**What it does:**
- Reads `./db.json` (legacy JSON Server format)
- Migrates all tasks + session events to SQLite via Drizzle ORM
- Idempotent (checks if already migrated, skips if so)

**Trigger:** Manual run (setup only, not part of regular signal flow)

---

#### `fix-tailwind-vars.ts` — Transpile Tailwind v4 Syntax

**What it does:**
- Recursively walks `src/` directory
- Converts `[var(--name)]` → `(--name)` (square to round brackets)
- Converts `data-[attr]` → `data-attr`, `data-[state=open]` → `data-state-open`
- Writes files in-place

**Trigger:** `bun run fix:tailwind` (build utility)

---

#### `wrap-md.js` — Markdown Line Wrapping Utility

**What it does:**
- Wraps markdown to 100-byte limit (matches linter behavior)
- Protects: code blocks, tables (|), headings (#)
- Reports remaining long lines

**Trigger:** `bun scripts/wrap-md.js <file.md>` (manual)

**Use case:** Pre-commit formatting for docs

---

## Key Patterns & Design Decisions

### 1. Dual Lookup Strategy
Scripts prefer `agentId` when available (subagent tasks), fall back to `sessionId` for
main-session tasks. This handles both parent tasks and independent subagent trees.

### 2. Temp File Coordination (`/tmp/cc-*`)
Bridges race conditions between async hooks:
- `pre-tool-agent.ts` writes `/tmp/cc-agent-task-{sessionId}` after POST /tasks succeeds
- `session-event.sh` (SubagentStart) reads this file to link parent task
- Fallback: API query if file doesn't exist yet (handles slow POST responses)

### 3. Metadata Embedding in Description
Task metadata (parentId, dependsOn, kind) encoded as bracket tags in task description:
```
"Subagent task [parentId:abc123] [dependsOn:xyz,def] [kind:evaluation]"
```

Parser extracts these at task creation time, enabling hierarchy + dependency tracking.

### 4. Event Immutability Pattern
- HookEvents are **appended** to task.events array (never deleted)
- Completion updates **map-transform** the array (replace matching event, preserve others)
- This creates an immutable audit trail of every tool call

### 5. Flexible SessionEvent Metadata
SessionEvents store event-specific data in a JSON field (not typed columns), preventing
schema explosion. Examples:
- `UserPromptSubmit` → includes detected skill name
- `Notification` → includes message content
- `PreCompact` → includes token count

### 6. Retry Logic with Exponential Backoff
`session-event.sh` uses retry logic (100ms → 200ms → 400ms, 3 attempts) for network
resilience. Important for unreliable conditions or slow API startup.

### 7. Skill Attribution
`UserPromptSubmit` hook detects `/skill-name` and writes to `/tmp/cc-skill-{sessionId}`.
Subsequent `pre-tool-agent.ts` reads this, embedding skill origin in task metadata. This
traces every task back to its originating skill (or main session).

---

## Known Issues

| Issue | File | Impact |
|-------|------|--------|
| Truncated file (1 line) | `post-tool-agent.ts` | Subagent completion not logged; tasks stay 'running' |
| Undefined `rawName` variable | `post-tool-agent.ts` | Script will crash if run |
| taskId extracted as ReadableStream | `post-task.ts` | CLI tool doesn't return valid taskId |
| Type mismatch: POST response parsing | `post-task.ts` | Caller can't capture taskId from stdout |
| Incomplete type narrowing | `post-task.ts` | CLI args not validated for correct types |

---

## Integration Checklist

To enable the full signal chain:

1. ✅ **Hono server** running on `:3001` (handles PATCH /tasks, POST /sessionEvents)
2. ✅ **SQLite database** with tasksTable, sessionEventsTable, sessionsTable
3. ✅ **Hook scripts** configured in Claude Code settings (`.claude/settings.json`)
4. ✅ **Vite dev server** on `:5173` with proxy to `:3001`
5. ✅ **useTaskPolling(2500)** in frontend polling /api/tasks every 2.5s
6. ⚠️ **post-tool-agent.ts** needs completion (currently incomplete)
7. ⚠️ **post-task.ts** needs taskId bug fix (response parsing)

---

## Related Files

| File | Purpose |
|------|---------|
| `src/types/task.ts` | Task, TaskNode, HookEvent, SessionEvent type definitions |
| `src/server.ts` | Hono API endpoints (GET/POST/PATCH /tasks, /sessionEvents) |
| `src/db/schema.ts` | Drizzle schema (tasksTable, sessionEventsTable) |
| `src/hooks/useTaskPolling.ts` | Frontend polling loop + client-side tree building |
| `src/components/TaskTable.tsx` | Task UI rendering |
| `docs/FOR_ETHAN.md` | High-level project narrative + decision log |
| `.claude/settings.json` | Claude Code hook configuration |

---

## See Also

- **CLAUDE.md** — Project stack & architecture overview
- **FOR_ETHAN.md** — Decision log + director's commentary
- **vite.config.ts** — Vite proxy configuration (routes `/api/*` to `:3001`)
