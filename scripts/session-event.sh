#!/bin/bash
# Claude Code session-level event hook.
# Handles: UserPromptSubmit, SessionStart, Stop, SubagentStart, SubagentStop,
#          Notification, PermissionRequest, PreCompact, PostToolUseFailure
#
# Usage: session-event.sh --event-type TYPE
#
# Common hook stdin fields (always present):
#   .session_id         → links event to its Claude session
#   .agent_id           → present when hook fires inside a subagent
#   .agent_type         → agent name ("Explore", "general-purpose", etc.)
#
# Event-specific stdin fields:
#   .prompt             → UserPromptSubmit
#   .model              → SessionStart
#   .message            → Notification
#   .notification_type  → Notification
#   .tool_name          → PermissionRequest, PostToolUseFailure
#   .error              → PostToolUseFailure
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

# ── Common agent fields ────────────────────────────────────────────────────────
# agent_id and agent_type are present in ALL hook payloads when the hook fires
# inside a subagent context (not just SubagentStart/SubagentStop).
# Extracting them here makes attribution universal across all event types.
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# ── Event-specific summary and extra fields ────────────────────────────────────
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
    SUMMARY="agent ${AGENT_ID:-unknown} started"
    EXTRA_FIELDS="{}"
    ;;
  SubagentStop)
    SUMMARY="agent ${AGENT_ID:-unknown} finished"
    EXTRA_FIELDS="{}"
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

# ── Agent attribution ──────────────────────────────────────────────────────────
# Merge agentId + agentType into the event whenever they are present.
# For events fired inside a subagent (any type), this captures which agent
# generated the event. For main-session events, AGENT_FIELDS is empty {}.
if [ -n "$AGENT_ID" ]; then
  AGENT_FIELDS=$(jq -n \
    --arg id "$AGENT_ID" \
    --arg type "$AGENT_TYPE" \
    '{ agentId: $id } + (if $type != "" then { agentType: $type } else {} end)')
else
  AGENT_FIELDS="{}"
fi

# ── Build and POST the session event ──────────────────────────────────────────
SESSION_EVENT=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg type "$EVENT_TYPE" \
  --arg now "$NOW" \
  --arg sessionId "$SESSION_ID" \
  --arg summary "$SUMMARY" \
  --argjson extra "$EXTRA_FIELDS" \
  --argjson agent "$AGENT_FIELDS" \
  '{
    id: $id,
    type: $type,
    timestamp: $now,
    sessionId: $sessionId,
    summary: $summary
  } + $extra + $agent')

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/sessionEvents \
  -H "Content-Type: application/json" \
  -d "$SESSION_EVENT")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "201" ]; then
  log "OK: $EVENT_TYPE — $SUMMARY (session $SESSION_ID${AGENT_ID:+ agent $AGENT_ID})"
else
  log "ERROR: POST /sessionEvents failed (HTTP $HTTP_CODE) for $EVENT_TYPE — is json-server running on :3001?"
fi
