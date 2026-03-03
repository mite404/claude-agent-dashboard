# Claude Code Hook Integration

The dashboard reads task data from the json-server REST API (`db.json`).
A Claude Code hook is responsible for writing current task state to `db.json`
whenever the Agent tool fires.

---

## How it works

```
Claude Code agent runs → PostToolUse hook fires → script updates db.json → dashboard polls & renders
```

---

## Hook type: PostToolUse (Agent tool)

Add this to your `~/.claude/settings.json` (or project `.claude/settings.json`):

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

---

## update-tasks.sh

Create `scripts/update-tasks.sh` in this repo (make it executable: `chmod +x`):

```bash
#!/usr/bin/env bash
# Reads the hook input from stdin, extracts task data,
# and appends/updates it in db.json

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$DASHBOARD_DIR/db.json"

# Hook stdin provides JSON context including tool_use_id, tool_input, tool_result
INPUT=$(cat)

TASK_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // {}')
TOOL_RESULT=$(echo "$INPUT" | jq -r '.tool_result // {}')

TASK_NAME=$(echo "$TOOL_INPUT" | jq -r '.description // "Unnamed task"')
SUBAGENT_TYPE=$(echo "$TOOL_INPUT" | jq -r '.subagent_type // "general-purpose"')
IS_BG=$(echo "$TOOL_INPUT" | jq -r '.run_in_background // false')
STATUS="completed"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Build a log entry from the tool result
LOG_MSG=$(echo "$TOOL_RESULT" | jq -r 'if type == "string" then . else tostring end' | head -c 200)

NEW_TASK=$(jq -n \
  --arg id "$TASK_ID" \
  --arg name "$TASK_NAME" \
  --arg status "$STATUS" \
  --arg agent "$SUBAGENT_TYPE" \
  --arg now "$NOW" \
  --arg logmsg "$LOG_MSG" \
  '{
    id: $id,
    name: $name,
    status: $status,
    agentType: $agent,
    parentId: null,
    createdAt: $now,
    startedAt: $now,
    completedAt: $now,
    progressPercentage: 100,
    logs: [
      { timestamp: $now, level: "info", message: ("Task completed: " + $logmsg) }
    ]
  }')

# Read current db.json, upsert the task (replace if id exists, otherwise append)
if [ ! -f "$DB_FILE" ]; then
  echo '{"tasks":[]}' > "$DB_FILE"
fi

jq --argjson task "$NEW_TASK" '
  .tasks = (
    if any(.tasks[]; .id == $task.id)
    then [.tasks[] | if .id == $task.id then $task else . end]
    else .tasks + [$task]
    end
  )
' "$DB_FILE" > "$DB_FILE.tmp" && mv "$DB_FILE.tmp" "$DB_FILE"
```

---

## Notes

- The hook fires **after** each Agent tool call completes.
- For **background tasks** (run_in_background: true), status will initially be `running`.
  You'd need a second hook on task completion to update it to `completed`.
- For richer progress tracking, emit intermediate log entries using a custom
  `PreToolUse` hook that marks the task as `running` when it starts.
- `tool_use_id` is used as the unique task ID — this matches what Claude Code
  internally tracks.
