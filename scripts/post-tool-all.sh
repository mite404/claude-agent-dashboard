#!/bin/bash
# Claude Code PostToolUse hook — fires on ALL tools (empty matcher).
# Also handles PostToolUseFailure for non-Agent tools.
# Finds the matching pre-event in the parent task and marks it completed/failed.
#
# Hook stdin fields used:
#   .session_id           → used to find the parent running task
#   .tool_name            → used to skip Agent calls
#   .tool_use_id          → matches the pre-event by id
#   .tool_response        → is_error flag

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$DASHBOARD_DIR/logs/hooks.log"

log() {
  echo "[$(date -u +"%H:%M:%S")] [post-all] $*" >> "$LOG_FILE"
}

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
EVENT_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
SESSION_ID=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
IS_ERROR=$(echo "$INPUT" | jq -r '(.tool_response // .tool_result // {}) | .is_error // false')

# Skip Agent tool calls — handled by post-tool-agent.sh
if [ "$TOOL_NAME" = "Agent" ] || [ "$TOOL_NAME" = "Task" ]; then
  exit 0
fi

if [ -z "$SESSION_ID" ]; then
  log "SKIP: no session_id in hook payload for $TOOL_NAME ($EVENT_ID)"
  exit 0
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

if [ "$IS_ERROR" = "true" ]; then
  FINAL_STATUS="failed"
else
  FINAL_STATUS="completed"
fi

# Find the running task for this session (task may still be running when sub-tool completes)
TASK_JSON=$(curl -s "http://localhost:3001/tasks?sessionId=$SESSION_ID" | jq '[.[] | select(.status == "running" or .status == "paused")] | .[0] // empty')

if [ -z "$TASK_JSON" ] || [ "$TASK_JSON" = "null" ]; then
  log "SKIP: no active task for session $SESSION_ID ($TOOL_NAME)"
  exit 0
fi

TASK_ID=$(echo "$TASK_JSON" | jq -r '.id')

# Find the pre-event in the task's events array and update its status + completedAt
EXISTING=$(curl -s "http://localhost:3001/tasks/$TASK_ID")

if ! echo "$EXISTING" | jq -e '.id' > /dev/null 2>&1; then
  log "SKIP: task $TASK_ID not found"
  exit 0
fi

# Check if this event ID exists in the events array
HAS_EVENT=$(echo "$EXISTING" | jq --arg id "$EVENT_ID" '[.events // [] | .[] | select(.id == $id)] | length > 0')

if [ "$HAS_EVENT" = "false" ]; then
  log "SKIP: event $EVENT_ID not found in task $TASK_ID events"
  exit 0
fi

UPDATED=$(echo "$EXISTING" | jq \
  --arg id "$EVENT_ID" \
  --arg status "$FINAL_STATUS" \
  --arg now "$NOW" \
  '.events = [
    .events[] |
    if .id == $id then
      . + { phase: "post", status: $status, completedAt: $now }
    else
      .
    end
  ]')

RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "http://localhost:3001/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "$UPDATED")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  log "OK: updated event $EVENT_ID ($TOOL_NAME) → $FINAL_STATUS on task $TASK_ID"
else
  log "ERROR: PUT /tasks/$TASK_ID failed (HTTP $HTTP_CODE) for event $EVENT_ID"
fi
