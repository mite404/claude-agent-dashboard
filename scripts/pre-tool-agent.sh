#!/bin/bash
# Claude Code PreToolUse hook — fires when an Agent tool call starts.
# Reads hook context from stdin, creates a "running" task in db.json.
#
# Hook stdin fields used:
#   .tool_use_id               → task id
#   .tool_input.description    → task name
#   .tool_input.subagent_type  → agentType

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$DASHBOARD_DIR/db.json"

INPUT=$(cat)

TASK_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
TASK_NAME=$(echo "$INPUT" | jq -r '.tool_input.description // "Unnamed task"')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

NEW_TASK=$(jq -n \
  --arg id "$TASK_ID" \
  --arg name "$TASK_NAME" \
  --arg agent "$SUBAGENT_TYPE" \
  --arg now "$NOW" \
  '{
    id: $id,
    name: $name,
    status: "running",
    agentType: $agent,
    parentId: null,
    createdAt: $now,
    startedAt: $now,
    completedAt: null,
    progressPercentage: 0,
    logs: [
      { timestamp: $now, level: "info", message: ("Task started: " + $name) }
    ]
  }')

# Bootstrap db.json if it doesn't exist or if .tasks key is missing/null
if [ ! -f "$DB_FILE" ] || ! jq -e '.tasks' "$DB_FILE" > /dev/null 2>&1; then
  echo '{"tasks":[]}' > "$DB_FILE"
fi

# Upsert: replace if id exists, append if new. Atomic write via temp file.
jq --argjson task "$NEW_TASK" '
  .tasks = (
    if any(.tasks[]; .id == $task.id)
    then [.tasks[] | if .id == $task.id then $task else . end]
    else .tasks + [$task]
    end
  )
' "$DB_FILE" > "$DB_FILE.tmp" && mv "$DB_FILE.tmp" "$DB_FILE"
