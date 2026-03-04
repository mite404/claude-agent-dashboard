#!/bin/bash
# Claude Code PostToolUse hook — fires when an Agent tool call ends.
# Reads hook context from stdin, updates the task status in db.json.
#
# Hook stdin fields used:
#   .tool_use_id                        → identifies which task to update
#   .tool_input.run_in_background       → if true, task is still running; don't mark complete
#   .tool_input.description             → fallback name if task doesn't exist yet
#   .tool_input.subagent_type           → fallback agentType if task doesn't exist yet
#   .tool_response // .tool_result      → completion data (key name varies by CC version)
#   .tool_response.is_error             → true if the agent failed

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$DASHBOARD_DIR/db.json"

INPUT=$(cat)

TASK_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
IS_BG=$(echo "$INPUT" | jq -r '.tool_input.run_in_background // false')
IS_ERROR=$(echo "$INPUT" | jq -r '(.tool_response // .tool_result // {}) | .is_error // false')
TASK_NAME=$(echo "$INPUT" | jq -r '.tool_input.description // "Unnamed task"')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Determine final status
if [ "$IS_BG" = "true" ]; then
  STATUS="running"
  PROGRESS=0
elif [ "$IS_ERROR" = "true" ]; then
  STATUS="failed"
  PROGRESS=0
else
  STATUS="completed"
  PROGRESS=100
fi

# Build the log entry inside jq to safely handle result content (avoids shell quoting issues)
NEW_LOG=$(echo "$INPUT" | jq \
  --arg now "$NOW" \
  --arg status "$STATUS" \
  --arg is_bg "$IS_BG" \
  '{
    timestamp: $now,
    level: (if $status == "failed" then "error" else "info" end),
    message: (
      if $is_bg == "true" then
        "Background task dispatched"
      elif $status == "failed" then
        "Task failed" + (
          (.tool_response // .tool_result // null) |
          if . == null then ""
          elif type == "string" then (": " + .[:300])
          elif .content then (
            ": " + (.content | if type == "array" then (.[0].text? // "") else "" end | .[:300])
          )
          else ""
          end
        )
      else
        "Task completed" + (
          (.tool_response // .tool_result // null) |
          if . == null then ""
          elif type == "string" then (": " + .[:300])
          elif .content then (
            ": " + (.content | if type == "array" then (.[0].text? // "") else "" end | .[:300])
          )
          else ""
          end
        )
      end
    )
  }')

# Bootstrap db.json if it doesn't exist or if .tasks key is missing/null
if [ ! -f "$DB_FILE" ] || ! jq -e '.tasks' "$DB_FILE" > /dev/null 2>&1; then
  echo '{"tasks":[]}' > "$DB_FILE"
fi

TASK_EXISTS=$(jq --arg id "$TASK_ID" 'any(.tasks[]; .id == $id)' "$DB_FILE")

if [ "$TASK_EXISTS" = "false" ]; then
  # Pre-hook didn't fire (e.g., hook was just installed mid-session). Create a fallback record.
  FALLBACK=$(jq -n \
    --arg id "$TASK_ID" \
    --arg name "$TASK_NAME" \
    --arg status "$STATUS" \
    --arg agent "$SUBAGENT_TYPE" \
    --arg now "$NOW" \
    --argjson progress "$PROGRESS" \
    --argjson log "$NEW_LOG" \
    '{
      id: $id,
      name: $name,
      status: $status,
      agentType: $agent,
      parentId: null,
      createdAt: $now,
      startedAt: $now,
      completedAt: (if $status == "running" then null else $now end),
      progressPercentage: $progress,
      logs: [$log]
    }')

  jq --argjson task "$FALLBACK" '.tasks += [$task]' \
    "$DB_FILE" > "$DB_FILE.tmp" && mv "$DB_FILE.tmp" "$DB_FILE"

elif [ "$IS_BG" = "true" ]; then
  # Background task: just append the log entry; status stays "running"
  jq \
    --arg id "$TASK_ID" \
    --argjson newlog "$NEW_LOG" \
    '.tasks = [.tasks[] | if .id == $id then . + {logs: (.logs + [$newlog])} else . end]' \
    "$DB_FILE" > "$DB_FILE.tmp" && mv "$DB_FILE.tmp" "$DB_FILE"

else
  # Foreground task: update status, completedAt, progress, and append log
  jq \
    --arg id "$TASK_ID" \
    --arg status "$STATUS" \
    --arg now "$NOW" \
    --argjson progress "$PROGRESS" \
    --argjson newlog "$NEW_LOG" \
    '.tasks = [
      .tasks[] | if .id == $id then
        . + {
          status: $status,
          completedAt: $now,
          progressPercentage: $progress,
          logs: (.logs + [$newlog])
        }
      else . end
    ]' \
    "$DB_FILE" > "$DB_FILE.tmp" && mv "$DB_FILE.tmp" "$DB_FILE"
fi
