# Claude Code Hook Integration

The dashboard reads task data from `db.json` via json-server. Two shell scripts act as
Claude Code hooks — they fire automatically whenever the Agent tool is used and write task
state to `db.json`, which the dashboard polls every 2.5 seconds.

---

## Signal Chain

```
User invokes Agent tool
  → PreToolUse hook → scripts/pre-tool-agent.sh
      → upserts { status: "running", progressPercentage: 0 } into db.json

  → Agent executes (seconds to minutes)

  → PostToolUse hook → scripts/post-tool-agent.sh
      → updates { status: "completed" | "failed", progressPercentage: 100 } in db.json

Dashboard polls /api/tasks every 2.5s → React table updates
```

`tool_use_id` is the stable identifier that links both hook calls for the same agent
invocation. The pre-hook creates a task record under that ID; the post-hook finds and
updates it by the same ID.

---

## Hook configuration (`~/.claude/settings.json`)

Wired **globally** so the dashboard tracks all Claude Code sessions, not just sessions
inside this project directory.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/pre-tool-agent.sh"
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
            "command": "/Users/ea/Programming/web/fractal/claude-agent-dashboard/scripts/post-tool-agent.sh"
          }
        ]
      }
    ]
  }
}
```

---

## `scripts/pre-tool-agent.sh` — PreToolUse hook

Fires when an Agent tool call **starts**. Creates a `running` task in `db.json`.

**Stdin fields used:**

| Field | Used as |
|-------|---------|
| `.tool_use_id` | task `id` |
| `.tool_input.description` | task `name` |
| `.tool_input.subagent_type` | task `agentType` |

**Task record created:**

```json
{
  "id":                 "<tool_use_id>",
  "name":               "<description or 'Unnamed task'>",
  "status":             "running",
  "agentType":          "<subagent_type or 'general-purpose'>",
  "parentId":           null,
  "createdAt":          "<now>",
  "startedAt":          "<now>",
  "completedAt":        null,
  "progressPercentage": 0,
  "logs": [{ "timestamp": "<now>", "level": "info", "message": "Task started: <name>" }]
}
```

Upsert logic: replaces the task if the ID already exists, appends if new.

---

## `scripts/post-tool-agent.sh` — PostToolUse hook

Fires when an Agent tool call **ends**. Updates the existing task in `db.json`.

**Stdin fields used:**

| Field | Used as |
|-------|---------|
| `.tool_use_id` | identifies which task to update |
| `.tool_input.run_in_background` | if `true`, task is still running — don't mark complete |
| `.tool_response // .tool_result` | completion content for the log message |
| `.tool_response.is_error` | `true` if the agent failed |

**Status logic:**

| Condition | Status | Progress |
|-----------|--------|----------|
| `run_in_background == true` | `running` | unchanged |
| `is_error == true` | `failed` | 0 |
| otherwise | `completed` | 100 |

**Fields updated on the existing record:**

```json
{
  "status":             "completed | failed | running",
  "completedAt":        "<now>",   // only if not background
  "progressPercentage": 100 | 0,
  "logs":               "<existing logs> + [new entry]"
}
```

If the task doesn't exist yet (pre-hook didn't fire), a fallback record is created with
best-effort data so the dashboard still shows something.

---

## Notes

- **Background tasks** — PostToolUse fires when the task is *dispatched*, not when it
  finishes. The post-hook detects `run_in_background: true` and leaves status as `running`.
  Phase 7 will add completion tracking for background tasks.
- **Atomic writes** — scripts always write to `db.json.tmp` then `mv` it into place.
  This prevents json-server from reading a half-written file.
- **Bootstrap guard** — both scripts recreate `db.json` as `{"tasks":[]}` if the file
  doesn't exist or if the `.tasks` key is missing/null (e.g., after manual edits).
- **Why bash** — hooks must run in any shell environment. Bash + `jq` is universally
  available on macOS; `bun` may not be in the hook runner's `$PATH`.
- **`jq` required** — install via `brew install jq` if not present.
