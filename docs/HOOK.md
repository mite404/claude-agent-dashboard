# Claude Code Hook Integration

The dashboard tracks Claude Code agent activity through TypeScript hook scripts.
These scripts fire automatically via Claude Code's hook system and write task state to SQLite
through the Hono REST API.
The frontend polls `/api/tasks` every 2.5 seconds and re-renders.

---

## Signal Chain

```
User invokes Agent tool
  → PreToolUse hook → scripts/pre-tool-agent.ts
      → POST /tasks { status: "running", progressPercentage: 0 }

  → Agent executes (seconds to minutes)

  → PostToolUse hook → scripts/post-tool-agent.ts
      → PATCH /tasks/:id { status: "completed" | "failed", progressPercentage: 100 }

  → Session lifecycle events → scripts/session-event.ts
      → POST /sessionEvents

Dashboard polls /api/tasks every 2.5s → React table updates
```

`tool_use_id` is the stable identifier linking both hook calls for the same agent invocation.
The pre-hook creates a task record under that ID; the post-hook finds and updates it.

---

## Hook configuration (`~/.claude/settings.json`)

Wired **globally** so the dashboard tracks all Claude Code sessions, not just sessions inside
this project.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/pre-tool-agent.ts"
          }
        ]
      },
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/pre-tool-all.ts"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/post-tool-agent.ts"
          }
        ]
      },
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/post-tool-all.ts"
          }
        ]
      }
    ]
  }
}
```

---

## `scripts/pre-tool-agent.ts` — PreToolUse hook (Agent matcher)

Fires when an Agent tool call **starts**. Creates a `running` task record via the REST API.

**Stdin fields used:**

| Field                       | Used as          |
| --------------------------- | ---------------- |
| `.tool_use_id`              | task `id`        |
| `.tool_input.description`   | task `name`      |
| `.tool_input.subagent_type` | task `agentType` |
| `.session_id`               | task `sessionId` |

**Task record created:**

```json
{
  "id": "<tool_use_id>",
  "name": "<description or 'Unnamed task'>",
  "status": "running",
  "agentType": "<subagent_type or 'general-purpose'>",
  "sessionId": "<session_id>",
  "parentId": null,
  "originatingSkill": "<skill name if applicable>",
  "createdAt": "<now>",
  "startedAt": "<now>",
  "progressPercentage": 0
}
```

**Metadata tags:** Task description can embed bracket-encoded metadata that is parsed out:

- `[parentId:abc123]` — links to a parent task
- `[dependsOn:xyz,def]` — array of blocking task IDs
- `[kind:work|evaluation|planning]` — shapes the visual badge in the dashboard

**Temp file coordination:**

- Reads `/tmp/cc-skill-{sessionId}` to capture the originating skill name
- Writes `/tmp/cc-agent-task-{sessionId}` for child agents to link back to this parent

---

## `scripts/post-tool-agent.ts` — PostToolUse hook (Agent matcher)

Fires when an Agent tool call **ends**. Updates the task's status via PATCH.

**Stdin fields used:**

| Field                            | Used as                                                |
| -------------------------------- | ------------------------------------------------------ |
| `.tool_use_id`                   | identifies which task to update                        |
| `.tool_input.run_in_background`  | if `true`, task is still running — don't mark complete |
| `.tool_response // .tool_result` | completion content for the log message                 |
| `.tool_response.is_error`        | `true` if the agent failed                             |

**Status logic:**

| Condition                   | Status      | Progress  |
| --------------------------- | ----------- | --------- |
| `run_in_background == true` | `running`   | unchanged |
| `is_error == true`          | `failed`    | 0         |
| otherwise                   | `completed` | 100       |

**Background tasks:** PostToolUse fires when the Agent tool returns, not when the background
agent actually finishes. The hook detects `run_in_background: true` and leaves status as
`running`. `session-event.ts` marks it complete when `SubagentStop` fires.

---

## `scripts/pre-tool-all.ts` and `scripts/post-tool-all.ts`

These hooks fire for every non-Agent tool call (Bash, Read, Write, Edit, Grep, etc.).
They create and update `HookEvent` records in the `hook_events` table, building a per-task
tool-call timeline visible in the dashboard's event trail.

**Pre-phase:** Creates a `HookEvent` with `phase='pre'`, `status='running'`.

**Post-phase:** Updates the matching `HookEvent` to `phase='post'`, `status='completed'`
or `'failed'`.

---

## `scripts/session-event.ts` — Session Lifecycle Events

Fires for all 18 Claude Code session lifecycle events.
Creates `SessionEvent` records and handles subagent task linkage.

**Key event handlers:**

| Event              | Action                                                      |
| ------------------ | ----------------------------------------------------------- |
| `SessionStart`     | Captures model name, creates session record                 |
| `UserPromptSubmit` | Detects `/skill-name`, writes `/tmp/cc-skill-{sessionId}`  |
| `SubagentStart`    | Reads temp file to link child agent back to parent task     |
| `SubagentStop`     | Marks parent task `completed`, `progressPercentage: 100`    |
| `Notification`     | Captures tool name and message                              |
| `PreCompact`       | Captures token count for context compression events         |

---

## Notes

- **Why TypeScript** — hooks run via Bun's absolute shebang (`#!/opt/homebrew/bin/bun`).
  This gives shared types from `src/types/task.ts`, native `fetch()`, and real error objects.
  The absolute path ensures Bun is found even when hooks run outside the login shell.
- **Server must be running** — each hook script checks `GET /tasks` (HEAD) on startup.
  If the Hono server is down, the script exits cleanly with code `0` so Claude Code is not
  blocked.
- **No `jq` required** — all JSON parsing is done in TypeScript via `JSON.parse()`.
