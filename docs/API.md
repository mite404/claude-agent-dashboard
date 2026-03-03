# Data Format Specification

The dashboard reads from json-server at `http://localhost:3001/tasks`.
The source of truth is `db.json` in the project root.

---

## db.json schema

```json
{
  "tasks": [Task]
}
```

json-server automatically exposes:
- `GET /tasks` — list all tasks
- `GET /tasks/:id` — get single task
- `POST /tasks` — create task
- `PATCH /tasks/:id` — partial update (used by Cancel/Pause/Retry buttons)
- `DELETE /tasks/:id` — remove task

---

## Task object

```typescript
interface Task {
  id: string              // Unique task ID (e.g., "task-001" or Claude tool_use_id)
  name: string            // Human-readable task description
  status: TaskStatus      // See below
  agentType: string       // Agent subtype (e.g., "general-purpose", "Explore")
  parentId: string | null // Parent task ID for subagent relationships; null = root
  createdAt: string       // ISO 8601 timestamp
  startedAt: string | null
  completedAt: string | null
  progressPercentage: number  // 0–100
  logs: LogEntry[]
}

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'

interface LogEntry {
  timestamp: string   // ISO 8601
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}
```

---

## Full example

```json
{
  "tasks": [
    {
      "id": "toolu_01AbCdEfGh",
      "name": "Research existing API endpoints",
      "status": "running",
      "agentType": "Explore",
      "parentId": null,
      "createdAt": "2026-03-03T10:28:00.000Z",
      "startedAt": "2026-03-03T10:28:05.000Z",
      "completedAt": null,
      "progressPercentage": 45,
      "logs": [
        {
          "timestamp": "2026-03-03T10:28:05.000Z",
          "level": "info",
          "message": "Task started"
        },
        {
          "timestamp": "2026-03-03T10:28:10.000Z",
          "level": "debug",
          "message": "Scanning src/routes/**"
        }
      ]
    },
    {
      "id": "toolu_02XyZAbCd",
      "name": "Write unit tests for auth module",
      "status": "completed",
      "agentType": "pr-review-toolkit:pr-test-analyzer",
      "parentId": "toolu_01AbCdEfGh",
      "createdAt": "2026-03-03T10:28:15.000Z",
      "startedAt": "2026-03-03T10:28:16.000Z",
      "completedAt": "2026-03-03T10:29:45.000Z",
      "progressPercentage": 100,
      "logs": [
        {
          "timestamp": "2026-03-03T10:29:45.000Z",
          "level": "info",
          "message": "All 12 tests passing"
        }
      ]
    }
  ]
}
```

---

## Vite proxy

In dev, Vite proxies `/api/*` → `http://localhost:3001/*` (stripping the `/api` prefix).
So the React app calls `/api/tasks` and json-server receives `/tasks`.
No CORS config needed.
