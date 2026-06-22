# API Reference

The dashboard backend is a **Hono REST API** (`src/server.ts`) running on port `3001`,
backed by SQLite via Drizzle ORM.
The Vite dev server proxies `/api/*` → `http://localhost:3001/*` (stripping the prefix)
so the React frontend calls `/api/tasks` and Hono receives `/tasks`.

Hook scripts call `http://localhost:3001` directly (no `/api` prefix).

---

## Endpoint Map

| Method   | Path                    | Called by              | Purpose                         |
| -------- | ----------------------- | ---------------------- | ------------------------------- |
| `GET`    | `/tasks`                | Frontend (polling)     | List all tasks                  |
| `GET`    | `/tasks/pool`           | Agents                 | List `unassigned` tasks by priority |
| `GET`    | `/tasks/:id`            | Agents / hooks         | Get single task                 |
| `POST`   | `/tasks`                | Hooks, pr-watcher, UI  | Create task                     |
| `POST`   | `/tasks/:id/claim`      | Agents                 | Atomically claim an unassigned task |
| `PATCH`  | `/tasks/:id`            | Hooks, UI              | Update task fields              |
| `PUT`    | `/tasks/:id`            | Legacy scripts         | Alias for PATCH                 |
| `DELETE` | `/tasks/:id`            | UI                     | Delete task                     |
| `GET`    | `/sessionEvents`        | Frontend               | List session events             |
| `POST`   | `/sessionEvents`        | `session-event.ts`     | Create session event            |
| `DELETE` | `/sessionEvents`        | UI ("Clear all")       | Delete all session events       |

---

## Task Schema

Defined in `src/db/schema.ts` (`tasksTable`).

```typescript
interface Task {
  id: string;                  // UUID or tool_use_id from Claude Code
  sessionId: string;           // Required — links to sessions table
  name: string;                // Human-readable task name
  description?: string;        // Optional detail / outcome summary
  status: TaskStatus;
  kind?: 'work' | 'evaluation' | 'planning';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  parentId?: string;           // For subagent tree relationships
  agentId?: string;            // Hex agent ID from SubagentStart hook
  agentType?: string;          // e.g. "general-purpose", "Explore"
  originatingSkill?: string;   // e.g. "/code-review"
  taskKind?: string;           // "orchestrator" | "work" | "background-task"
  claimedBy?: string;          // Agent or process that claimed the task
  claimedAt?: string;          // ISO timestamp of claim
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  progressPercentage?: number; // 0–100
}

type TaskStatus =
  | 'unassigned'  // in pool, waiting to be claimed
  | 'claimed'     // claimed by an agent, not yet started
  | 'running'     // actively executing
  | 'completed'   // finished successfully
  | 'failed'      // finished with error
  | 'paused'      // manually paused
  | 'cancelled'   // manually cancelled
  | 'blocked';    // waiting on a dependency (computed client-side)
```

**Note:** `logs` are stored in a separate `logsTable` (not embedded in the task object).
`hookEvents` are stored in `hookEventsTable`.

---

## POST /tasks — Create a task

**Required fields:** `name`, `sessionId`

```bash
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Review auth module",
    "sessionId": "orchestrator-session",
    "agentType": "code-reviewer",
    "priority": "high",
    "status": "unassigned",
    "description": "Check JWT validation and session expiry logic"
  }'
```

The server auto-upserts a `sessions` row for the `sessionId` via `onConflictDoNothing`,
so you don't need to pre-create a session before creating tasks.

**Response:** `201` with the created task object.

---

## POST /tasks/:id/claim — Claim a task

Atomically transitions a task from `unassigned` → `claimed`.
Returns `409` if the task is already claimed by someone else.

```bash
curl -X POST http://localhost:3001/tasks/abc123/claim \
  -H "Content-Type: application/json" \
  -d '{"claimedBy": "agent-xyz"}'
```

**Response:** `200` with updated task, or `409 { "claimedBy": "<who has it>" }`.

---

## PATCH /tasks/:id — Update a task

Whitelist of updatable fields (others are silently ignored):

`name`, `description`, `status`, `kind`, `priority`, `progressPercentage`,
`startedAt`, `completedAt`, `claimedAt`, `claimedBy`, `agentId`, `agentType`,
`originatingSkill`, `taskKind`, `parentId`

```bash
# Mark complete
curl -X PATCH http://localhost:3001/tasks/abc123 \
  -H "Content-Type: application/json" \
  -d '{"status": "completed", "progressPercentage": 100}'

# Return to pool
curl -X PATCH http://localhost:3001/tasks/abc123 \
  -H "Content-Type: application/json" \
  -d '{"status": "unassigned", "claimedBy": null, "claimedAt": null}'
```

---

## GET /tasks/pool — Unassigned task queue

Returns tasks with `status='unassigned'`, ordered by priority then `createdAt`.
Useful for agents polling for work.

```bash
curl http://localhost:3001/tasks/pool
# Response: { "data": [Task, ...] }
```

Priority order: `urgent` → `high` → `normal` → `low`.

---

## SessionEvent Schema

```typescript
interface SessionEvent {
  id: string;
  sessionId: string;
  type: string;         // e.g. "SessionStart", "UserPromptSubmit", "SubagentStop"
  summary?: string;
  timestamp?: string;
  agentId?: string;
  agentType?: string;
  model?: string;
  metadata?: object;    // event-specific data (token counts, skill names, etc.)
}
```

---

## Vite Proxy

In dev, Vite proxies `/api/*` → `http://localhost:3001/*` (configured in `vite.config.ts`).
The React app calls `/api/tasks`; Hono receives `/tasks`.
No CORS config needed for the frontend.

Hook scripts and `pr-watcher.ts` call `http://localhost:3001` directly (no proxy, no prefix).
