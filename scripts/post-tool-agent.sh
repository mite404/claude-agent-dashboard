#!/bin/bash
# Claude Code PostToolUse hook — fires when an Agent tool call ends.
# Reads hook context from stdin, updates the task status via the json-server API.
#
# Hook stdin fields used:
#   .session_id                         → sessionId (carried through to PUT)
#   .tool_use_id                        → identifies which task to update
#   .tool_input.run_in_background       → if true, task is still running; don't mark complete
#   .tool_input.description             → fallback name if task doesn't exist yet
#   .tool_input.subagent_type           → fallback agentType if task doesn't exist yet
#   .tool_response // .tool_result      → completion data (key name varies by CC version)
#   .tool_response.is_error             → true if the agent failed

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$DASHBOARD_DIR/db.json"
LOG_FILE="$DASHBOARD_DIR/logs/hooks.log"

log() {
  echo "[$(date -u +"%H:%M:%S")] [post-hook] $*" >> "$LOG_FILE"
}

# Ensure db.json is valid so json-server can start cleanly if restarted
if [ ! -f "$DB_FILE" ] || ! jq -e '.tasks' "$DB_FILE" > /dev/null 2>&1; then
  echo '{"tasks":[],"sessionEvents":[]}' > "$DB_FILE"
  log "WARN: db.json was missing or invalid — bootstrapped fresh"
fi

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
TASK_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
IS_BG=$(echo "$INPUT" | jq -r '.tool_input.run_in_background // false')
IS_ERROR=$(echo "$INPUT" | jq -r '(.tool_response // .tool_result // {}) | .is_error // false')
LAST_MSG=$(echo "$INPUT" | jq -r '
  (.tool_response // .tool_result // {}) |
  .last_assistant_message // empty
')
TASK_NAME=$(echo "$INPUT" | jq -r '.tool_input.description // "Unnamed task"')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Determine final status.
if [ "$IS_ERROR" = "true" ]; then
  STATUS="failed"
  PROGRESS=0
else
  STATUS="completed"
  PROGRESS=100
fi

# Build the log entry
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

# Fetch the existing task from json-server
EXISTING=$(curl -s "http://localhost:3001/tasks/$TASK_ID")

if echo "$EXISTING" | jq -e '.id' > /dev/null 2>&1; then
  # Task exists — build updated version and PUT it back (full replace preserves logs + events arrays)
  UPDATED=$(echo "$EXISTING" | jq \
    --arg status "$STATUS" \
    --arg now "$NOW" \
    --arg sessionId "$SESSION_ID" \
    --arg last_msg "$LAST_MSG" \
    --argjson progress "$PROGRESS" \
    --argjson newlog "$NEW_LOG" \
    '. + {
      status: $status,
      completedAt: $now,
      progressPercentage: $progress,
      logs: (.logs + [$newlog]),
      sessionId: (if $sessionId != "" then $sessionId else .sessionId end),
      lastAssistantMessage: (if $last_msg != "" then $last_msg else .lastAssistantMessage end)
    }')

  RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "http://localhost:3001/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -d "$UPDATED")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

  if [ "$HTTP_CODE" = "200" ]; then
    log "OK: updated task $TASK_ID → $STATUS"
  else
    log "ERROR: PUT /tasks/$TASK_ID failed (HTTP $HTTP_CODE)"
  fi

else
  # Pre-hook didn't fire (e.g., hook was just installed mid-session). Create a fallback record.
  log "WARN: task $TASK_ID not found — pre-hook may have missed it. Creating fallback."

  FALLBACK=$(jq -n \
    --arg id "$TASK_ID" \
    --arg name "$TASK_NAME" \
    --arg status "$STATUS" \
    --arg agent "$SUBAGENT_TYPE" \
    --arg now "$NOW" \
    --arg last_msg "$LAST_MSG" \
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
      logs: [$log],
      lastAssistantMessage: (if $last_msg != "" then $last_msg else null end)
    }')

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3001/tasks" \
    -H "Content-Type: application/json" \
    -d "$FALLBACK")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

  if [ "$HTTP_CODE" = "201" ]; then
    log "OK: fallback task created for $TASK_ID → $STATUS"
  else
    log "ERROR: POST /tasks (fallback) failed (HTTP $HTTP_CODE) — is json-server running on :3001?"
  fi
fi
