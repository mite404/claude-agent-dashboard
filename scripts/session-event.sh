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

# Retry a curl POST with exponential backoff (up to 3 attempts, 100ms → 200ms → 400ms)
retry_post() {
  local url="$1"
  local data="$2"
  local attempt=1
  local max_attempts=3

  while [ $attempt -le $max_attempts ]; do
    local response=$(curl -s -w "\n%{http_code}" -X POST "$url" \
      -H "Content-Type: application/json" \
      -d "$data")
    local http_code=$(echo "$response" | tail -n1)

    # Success (201 Created)
    if [ "$http_code" = "201" ]; then
      echo "$http_code"
      return 0
    fi

    # Server error or connection failure — retry
    if [ "$attempt" -lt $max_attempts ]; then
      sleep_ms=$((100 * attempt))
      sleep "0.$(printf '%03d' $sleep_ms)"
      attempt=$((attempt + 1))
    else
      # Final attempt failed
      echo "$http_code"
      return 1
    fi
  done
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
SAFE_SID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Generate a unique-enough ID: timestamp + event type slug
EVENT_ID="${NOW//[^0-9]/}-$(echo "$EVENT_TYPE" | tr '[:upper:]' '[:lower:]')"

# ── Common agent fields ────────────────────────────────────────────────────────
# Extract agent_id and agent_type from the hook payload
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')

# For SubagentStart: write the subagent's actual agent_id back to the task record so the
# task table can display the same ID shown in session events (for cross-reference)
if [[ "$EVENT_TYPE" == "SubagentStart" ]] && [ -n "$AGENT_ID" ]; then
  # Try temp file first; fall back to json-server query if file is empty (race condition)
  PARENT_TASK_ID=$(<"/tmp/cc-agent-task-$SAFE_SID" 2>/dev/null || true)
  if [ -z "$PARENT_TASK_ID" ]; then
    # json-server _sort conflicts with filter params — sort client-side via jq
    PARENT_TASK_ID=$(curl -s \
      "http://localhost:3001/tasks?sessionId=$SESSION_ID" \
      | jq -r 'sort_by(.createdAt) | reverse | .[0].id // empty')
    log "INFO: SubagentStart — temp file empty, looked up most recent task: $PARENT_TASK_ID"
  fi
  if [ -n "$PARENT_TASK_ID" ]; then
    PATCH=$(jq -n --arg aid "$AGENT_ID" '{ agentId: $aid }')
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3001/tasks/$PARENT_TASK_ID" \
      -H "Content-Type: application/json" \
      -d "$PATCH")
    log "INFO: patched task $PARENT_TASK_ID with agentId=$AGENT_ID (HTTP $HTTP_STATUS)"
    # Store mapping so SubagentStop can find the task even if the PATCH above raced with task creation
    echo "$PARENT_TASK_ID" > "/tmp/cc-agentid-$AGENT_ID"
  else
    log "WARN: SubagentStart — could not resolve parent task for agentId patch"
  fi
fi

# ── Event-specific summary and extra fields ────────────────────────────────────
case "$EVENT_TYPE" in
  UserPromptSubmit)
    PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
    SUMMARY=$(echo "\"${PROMPT:0:100}\"")

    # Detect /skill-name pattern and track for task attribution (Beat 1)
    SKILL=""
    if [[ "$PROMPT" == /* ]]; then
      SKILL=$(echo "$PROMPT" | grep -oE '^/[^ ]+' | head -1)
    fi

    if [ -n "$SKILL" ]; then
      EXTRA_FIELDS=$(jq -n --arg skill "$SKILL" '{ originatingSkill: $skill }')
      echo "$SKILL" > "/tmp/cc-skill-$SAFE_SID"
    else
      EXTRA_FIELDS="{}"
    fi
    ;;
  SessionStart)
    MODEL=$(echo "$INPUT" | jq -r '.model // "unknown"')
    SUMMARY="$MODEL"
    EXTRA_FIELDS=$(jq -n --arg model "$MODEL" '{ model: $model }')
    ;;
  Stop)
    SUMMARY="session ended"
    EXTRA_FIELDS="{}"
    # Clean up the skill temp file
    rm -f "/tmp/cc-skill-$SAFE_SID"
    ;;
  SubagentStart)
    SUMMARY="agent ${AGENT_ID:-unknown} started"
    EXTRA_FIELDS="{}"
    ;;
  SubagentStop)
    SUMMARY="agent ${AGENT_ID:-unknown} finished"
    EXTRA_FIELDS="{}"

    # Mark the background task as completed when the subagent finishes
    if [ -n "$AGENT_ID" ]; then
      TASK=$(curl -s "http://localhost:3001/tasks?sessionId=$SESSION_ID" \
        | jq "map(select(.agentId == \"$AGENT_ID\")) | .[0] // empty")

      # Fallback: agentId may not have been written to DB if SubagentStart raced with task creation
      if [ -z "$TASK" ] || ! echo "$TASK" | jq -e '.id' > /dev/null 2>&1; then
        FALLBACK_TASK_ID=$(<"/tmp/cc-agentid-$AGENT_ID" 2>/dev/null || true)
        if [ -n "$FALLBACK_TASK_ID" ]; then
          TASK=$(curl -s "http://localhost:3001/tasks/$FALLBACK_TASK_ID")
          log "INFO: SubagentStop — agentId not in DB, using temp file fallback for $FALLBACK_TASK_ID"
        fi
      fi

      if [ -n "$TASK" ] && echo "$TASK" | jq -e '.id' > /dev/null 2>&1; then
        TASK_ID=$(echo "$TASK" | jq -r '.id')
        PATCH=$(jq -n --arg status "completed" --arg now "$NOW" '{ status: $status, completedAt: $now, progressPercentage: 100 }')
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:3001/tasks/$TASK_ID" \
          -H "Content-Type: application/json" \
          -d "$PATCH")
        log "INFO: SubagentStop — marked task $TASK_ID as completed (HTTP $HTTP_STATUS)"
        rm -f "/tmp/cc-agentid-$AGENT_ID"
      fi
    fi
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
  SessionEnd)
    REASON=$(echo "$INPUT" | jq -r '.reason // "unknown"')
    SUMMARY="session ended: $REASON"
    EXTRA_FIELDS=$(jq -n --arg r "$REASON" '{ reason: $r }')
    ;;
  TeammateIdle)
    SUMMARY="teammate ${AGENT_ID:0:16} idle"
    EXTRA_FIELDS="{}"
    ;;
  TaskCompleted)
    TASK_TITLE=$(echo "$INPUT" | jq -r '.task_title // .task_id // "unknown"')
    SUMMARY="task completed: ${TASK_TITLE:0:80}"
    EXTRA_FIELDS=$(jq -n --arg t "$TASK_TITLE" '{ taskTitle: $t }')
    ;;
  InstructionsLoaded)
    FILE=$(echo "$INPUT" | jq -r '.file_path // "unknown"')
    SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"')
    SUMMARY="instructions loaded: $FILE"
    EXTRA_FIELDS=$(jq -n --arg f "$FILE" --arg s "$SOURCE" '{ filePath: $f, source: $s }')
    ;;
  ConfigChange)
    FILE=$(echo "$INPUT" | jq -r '.file_path // "unknown"')
    SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"')
    SUMMARY="config changed: $FILE ($SOURCE)"
    EXTRA_FIELDS=$(jq -n --arg f "$FILE" --arg s "$SOURCE" '{ filePath: $f, source: $s }')
    ;;
  WorktreeCreate)
    BRANCH=$(echo "$INPUT" | jq -r '.branch // "unknown"')
    SUMMARY="worktree created: $BRANCH"
    EXTRA_FIELDS=$(jq -n --arg b "$BRANCH" '{ branch: $b }')
    ;;
  WorktreeRemove)
    BRANCH=$(echo "$INPUT" | jq -r '.branch // "unknown"')
    SUMMARY="worktree removed: $BRANCH"
    EXTRA_FIELDS=$(jq -n --arg b "$BRANCH" '{ branch: $b }')
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

HTTP_CODE=$(retry_post "http://localhost:3001/sessionEvents" "$SESSION_EVENT")

if [ "$HTTP_CODE" = "201" ]; then
  log "OK: $EVENT_TYPE — $SUMMARY (session $SESSION_ID${AGENT_ID:+ agent $AGENT_ID})"
else
  log "ERROR: POST /sessionEvents failed (HTTP $HTTP_CODE) for $EVENT_TYPE — is json-server running on :3001?"
fi
