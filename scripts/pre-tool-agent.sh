#!/bin/bash
# Claude Code PreToolUse hook — fires when an Agent tool call starts.
# Reads hook context from stdin, creates a "running" task via the json-server API.
#
# Hook stdin fields used:
#   .tool_use_id               → task id
#   .tool_input.description    → task name
#   .tool_input.subagent_type  → agentType

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$DASHBOARD_DIR/db.json"
LOG_FILE="$DASHBOARD_DIR/logs/hooks.log"

log() {
  echo "[$(date -u +"%H:%M:%S")] [pre-hook] $*" >> "$LOG_FILE"
}

# Ensure db.json is valid so json-server can start cleanly if restarted
if [ ! -f "$DB_FILE" ] || ! jq -e '.tasks' "$DB_FILE" > /dev/null 2>&1; then
  echo '{"tasks":[]}' > "$DB_FILE"
  log "WARN: db.json was missing or invalid — bootstrapped fresh"
fi

INPUT=$(cat)

TASK_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
RAW_NAME=$(echo "$INPUT" | jq -r '.tool_input.description // "Unnamed task"')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')

# Extract optional [parentId:XXX] tag from description, then strip it from display name
PARENT_TAG=$(echo "$RAW_NAME" | grep -oE '\[parentId:[^]]+\]' || true)
if [ -n "$PARENT_TAG" ]; then
  PARENT_ID=$(echo "$PARENT_TAG" | sed 's/\[parentId://;s/\]//')
  TASK_NAME=$(echo "$RAW_NAME" | sed 's/ \[parentId:[^]]*\]//' | sed 's/\[parentId:[^]]*\] //' | sed 's/\[parentId:[^]]*\]//')
else
  PARENT_ID=""
  TASK_NAME="$RAW_NAME"
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

NEW_TASK=$(jq -n \
  --arg id "$TASK_ID" \
  --arg name "$TASK_NAME" \
  --arg agent "$SUBAGENT_TYPE" \
  --arg now "$NOW" \
  --arg parentId "$PARENT_ID" \
  '{
    id: $id,
    name: $name,
    status: "running",
    agentType: $agent,
    parentId: (if $parentId == "" then null else $parentId end),
    createdAt: $now,
    startedAt: $now,
    completedAt: null,
    progressPercentage: 0,
    logs: [
      { timestamp: $now, level: "info", message: ("Task started: " + $name) }
    ]
  }')

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d "$NEW_TASK")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "201" ]; then
  if [ -n "$PARENT_ID" ]; then
    log "OK: created task $TASK_ID (\"$TASK_NAME\", $SUBAGENT_TYPE, parentId=$PARENT_ID)"
  else
    log "OK: created task $TASK_ID (\"$TASK_NAME\", $SUBAGENT_TYPE)"
  fi
else
  log "ERROR: POST /tasks failed (HTTP $HTTP_CODE) — is json-server running on :3001?"
fi
