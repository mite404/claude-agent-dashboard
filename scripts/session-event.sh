#!/bin/bash
# Claude Code session-level event hook.
# Handles: UserPromptSubmit, SessionStart, Stop, SubagentStart, SubagentStop,
#          Notification, PermissionRequest, PreCompact, PostToolUseFailure
#
# Usage: session-event.sh --event-type TYPE
#
# Hook stdin fields used (varies by event type):
#   .session_id         → always present
#   .prompt             → UserPromptSubmit
#   .model              → SessionStart
#   .agent_id           → SubagentStart, SubagentStop
#   .message            → Notification
#   .notification_type  → Notification
#   .tool_name          → PermissionRequest, PostToolUseFailure
#   .token_count        → PreCompact

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$DASHBOARD_DIR/logs/hooks.log"

log() {
  echo "[$(date -u +"%H:%M:%S")] [session] $*" >> "$LOG_FILE"
}

# Parse --event-type argument
EVENT_TYPE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --event-type) EVENT_TYPE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$EVENT_TYPE" ]; then
  log "ERROR: --event-type is required"
  exit 1
fi

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Generate a unique-enough ID: timestamp + event type slug
EVENT_ID="${NOW//[^0-9]/}-$(echo "$EVENT_TYPE" | tr '[:upper:]' '[:lower:]')"

# Build event-type-specific summary and extra fields
case "$EVENT_TYPE" in
  UserPromptSubmit)
    PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
    SUMMARY=$(echo "\"${PROMPT:0:100}\"")
    EXTRA_FIELDS="{}"
    ;;
  SessionStart)
    MODEL=$(echo "$INPUT" | jq -r '.model // "unknown"')
    SUMMARY="$MODEL"
    EXTRA_FIELDS=$(jq -n --arg model "$MODEL" '{ model: $model }')
    ;;
  Stop)
    SUMMARY="session ended"
    EXTRA_FIELDS="{}"
    ;;
  SubagentStart)
    AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // "unknown"')
    SUMMARY="agent $AGENT_ID"
    EXTRA_FIELDS=$(jq -n --arg id "$AGENT_ID" '{ agentId: $id }')
    ;;
  SubagentStop)
    AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // "unknown"')
    SUMMARY="agent $AGENT_ID finished"
    EXTRA_FIELDS=$(jq -n --arg id "$AGENT_ID" '{ agentId: $id }')
    ;;
  Notification)
    MESSAGE=$(echo "$INPUT" | jq -r '.message // ""')
    NOTIF_TYPE=$(echo "$INPUT" | jq -r '.notification_type // ""')
    SUMMARY="${NOTIF_TYPE}: ${MESSAGE:0:80}"
    EXTRA_FIELDS=$(jq -n --arg msg "$MESSAGE" --arg type "$NOTIF_TYPE" '{ message: $msg, notificationType: $type }')
    ;;
  PermissionRequest)
    TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    SUMMARY="$TOOL requested"
    EXTRA_FIELDS=$(jq -n --arg tool "$TOOL" '{ toolName: $tool }')
    ;;
  PreCompact)
    TOKEN_COUNT=$(echo "$INPUT" | jq -r '.token_count // null')
    SUMMARY="context compaction triggered"
    [ "$TOKEN_COUNT" != "null" ] && SUMMARY="context compaction (${TOKEN_COUNT} tokens)"
    EXTRA_FIELDS=$(jq -n --argjson count "${TOKEN_COUNT:-null}" '{ tokenCount: $count }')
    ;;
  PostToolUseFailure)
    TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
    ERROR=$(echo "$INPUT" | jq -r '.error // ""')
    SUMMARY="$TOOL failed: ${ERROR:0:80}"
    EXTRA_FIELDS=$(jq -n --arg tool "$TOOL" --arg err "$ERROR" '{ toolName: $tool, error: $err }')
    ;;
  *)
    SUMMARY="$EVENT_TYPE"
    EXTRA_FIELDS="{}"
    ;;
esac

# Build the session event object
SESSION_EVENT=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg type "$EVENT_TYPE" \
  --arg now "$NOW" \
  --arg sessionId "$SESSION_ID" \
  --arg summary "$SUMMARY" \
  --argjson extra "$EXTRA_FIELDS" \
  '{
    id: $id,
    type: $type,
    timestamp: $now,
    sessionId: $sessionId,
    summary: $summary
  } + $extra')

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/sessionEvents \
  -H "Content-Type: application/json" \
  -d "$SESSION_EVENT")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "201" ]; then
  log "OK: $EVENT_TYPE — $SUMMARY (session $SESSION_ID)"
else
  log "ERROR: POST /sessionEvents failed (HTTP $HTTP_CODE) for $EVENT_TYPE — is json-server running on :3001?"
fi
