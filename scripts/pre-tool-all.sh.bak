#!/bin/bash
# Claude Code PreToolUse hook — fires on ALL tools (empty matcher).
# For non-Agent tools, finds the running task for this session and appends
# a pre-event to its events array. Agent tool calls are skipped here
# (handled by pre-tool-agent.sh via the "Agent" matcher).
#
# Hook stdin fields used:
#   .session_id    → used to find the parent running task
#   .tool_name     → Bash, Read, Write, Edit, Grep, Glob, etc.
#   .tool_use_id   → event id
#   .tool_input    → summarized for display

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$DASHBOARD_DIR/logs/hooks.log"

log() {
  echo "[$(date -u +"%H:%M:%S")] [pre-all] $*" >> "$LOG_FILE"
}

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
EVENT_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
SESSION_ID=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')

# Skip Agent tool calls — handled by pre-tool-agent.sh
if [ "$TOOL_NAME" = "Agent" ] || [ "$TOOL_NAME" = "Task" ]; then
  exit 0
fi

# Skip if no session to attribute to
if [ -z "$SESSION_ID" ]; then
  log "SKIP: no session_id in hook payload for $TOOL_NAME ($EVENT_ID)"
  exit 0
fi

# Build a human-readable summary from tool_input
# Each tool type uses a different field as the display value
SUMMARY=$(echo "$INPUT" | jq -r \
  --arg tool "$TOOL_NAME" \
  '.tool_input |
  if $tool == "Bash" then (.command // .cmd // "" | .[:120])
  elif $tool == "Read" then (.file_path // .path // "" | .[:120])
  elif $tool == "Write" then (.file_path // .path // "" | .[:120])
  elif $tool == "Edit" then (.file_path // .path // "" | .[:120])
  elif $tool == "Grep" then ((.pattern // "") + " " + (.path // "") | .[:120])
  elif $tool == "Glob" then (.pattern // "" | .[:120])
  elif $tool == "WebFetch" then (.url // "" | .[:120])
  elif $tool == "WebSearch" then (.query // "" | .[:120])
  else (. | tostring | .[:120])
  end')

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Find the running task for this tool call
# Two paths: direct lookup by agent_id (subagent context), fallback to sessionId query
if [ -n "$AGENT_ID" ]; then
  # Direct lookup: agent_id == tool_use_id == task.id in pre-tool-agent.sh
  RUNNING_TASK=$(curl -s "http://localhost:3001/tasks/$AGENT_ID")
  LOOKUP_METHOD="agent_id"
else
  # Fallback for main-session tool calls (no subagent context)
  RUNNING_TASK=$(curl -s "http://localhost:3001/tasks?status=running&sessionId=$SESSION_ID" | jq '.[0] // empty')
  LOOKUP_METHOD="sessionId"
fi

if [ -z "$RUNNING_TASK" ] || [ "$RUNNING_TASK" = "null" ]; then
  log "SKIP: no running task found for $TOOL_NAME ($EVENT_ID) [via $LOOKUP_METHOD]"
  exit 0
fi

TASK_ID=$(echo "$RUNNING_TASK" | jq -r '.id')

# Build the new event entry
NEW_EVENT=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg tool "$TOOL_NAME" \
  --arg summary "$SUMMARY" \
  --arg now "$NOW" \
  '{
    id: $id,
    toolName: $tool,
    phase: "pre",
    status: "running",
    summary: $summary,
    timestamp: $now
  }')

# Append event to task via GET→mutate→PUT
EXISTING=$(curl -s "http://localhost:3001/tasks/$TASK_ID")

if ! echo "$EXISTING" | jq -e '.id' > /dev/null 2>&1; then
  log "SKIP: task $TASK_ID not found in json-server"
  exit 0
fi

UPDATED=$(echo "$EXISTING" | jq \
  --argjson event "$NEW_EVENT" \
  '. + { events: ((.events // []) + [$event]) }')

RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "http://localhost:3001/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d "$UPDATED")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  log "OK: appended event to task $TASK_ID ($TOOL_NAME) [via $LOOKUP_METHOD]"
else
  log "ERROR: PATCH /tasks/$TASK_ID failed (HTTP $HTTP_CODE) for event $EVENT_ID"
fi
