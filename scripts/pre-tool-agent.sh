#!/bin/bash
# Claude Code PreToolUse hook — fires when an Agent tool call starts.
# Reads hook context from stdin, creates a "running" task via the json-server API.
#
# Hook stdin fields used:
#   .session_id                → sessionId (links task to its Claude session)
#   .tool_use_id               → task id
#   .tool_input.description    → task name (may contain [parentId:XXX] and [dependsOn:ID1,ID2] tags)
#   .tool_input.subagent_type  → agentType

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$DASHBOARD_DIR/db.json"
LOG_FILE="$DASHBOARD_DIR/logs/hooks.log"

log() {
  echo "[$(date -u +"%H:%M:%S")] [pre-hook] $*" >> "$LOG_FILE"
}

# Ensure db.json is valid so json-server can start cleanly if restarted
if [ ! -f "$DB_FILE" ] || ! jq -e '.tasks' "$DB_FILE" > /dev/null 2>&1; then
  echo '{"tasks":[],"sessionEvents":[]}' > "$DB_FILE"
  log "WARN: db.json was missing or invalid — bootstrapped fresh"
fi

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
TASK_ID=$(echo "$INPUT" | jq -r '.tool_use_id // "unknown"')
RAW_NAME=$(echo "$INPUT" | jq -r '.tool_input.description // "Unnamed task"')
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // "general-purpose"')

# Store parent Agent's tool_use_id in a temp file so SubagentStart hook can link back to this task
SAFE_SID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
echo "$TASK_ID" > "/tmp/cc-agent-task-$SAFE_SID"

# Extract optional [parentId:XXX] tag from description, then strip it from display name
PARENT_TAG=$(echo "$RAW_NAME" | grep -oE '\[parentId:[^]]+\]' || true)
if [ -n "$PARENT_TAG" ]; then
  PARENT_ID=$(echo "$PARENT_TAG" | sed 's/\[parentId://;s/\]//')
  TASK_NAME=$(echo "$RAW_NAME" | sed 's/ \[parentId:[^]]*\]//' | sed 's/\[parentId:[^]]*\] //' | sed 's/\[parentId:[^]]*\]//')
else
  PARENT_ID=""
  TASK_NAME="$RAW_NAME"
fi

# Extract optional [dependsOn:ID1,ID2] tag — comma-separated task IDs this task waits for
DEPENDS_TAG=$(echo "$TASK_NAME" | grep -oE '\[dependsOn:[^]]+\]' || true)
if [ -n "$DEPENDS_TAG" ]; then
  DEPENDS_RAW=$(echo "$DEPENDS_TAG" | sed 's/\[dependsOn://;s/\]//')
  # Convert "ID1,ID2" → JSON array ["ID1","ID2"]
  DEPENDENCIES=$(echo "$DEPENDS_RAW" | jq -Rc 'split(",")')
  TASK_NAME=$(echo "$TASK_NAME" | sed 's/ \[dependsOn:[^]]*\]//' | sed 's/\[dependsOn:[^]]*\] //' | sed 's/\[dependsOn:[^]]*\]//')
else
  DEPENDENCIES="[]"
fi

# Read the originating skill (if this session started with /skill-name) — Beat 2
SAFE_SID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
SKILL_FILE="/tmp/cc-skill-$SAFE_SID"
ORIGINATING_SKILL=""
if [ -f "$SKILL_FILE" ]; then
  ORIGINATING_SKILL=$(<"$SKILL_FILE")
  ORIGINATING_SKILL="${ORIGINATING_SKILL//[^a-zA-Z0-9\/_-]/}"
fi

# Detect evaluation/planning vs. work tasks
KIND_TAG=$(echo "$TASK_NAME" | grep -oE '\[kind:[^]]+\]' || true)
if [ -n "$KIND_TAG" ]; then
  TASK_KIND=$(echo "$KIND_TAG" | sed 's/\[kind://;s/\]//')
  TASK_NAME=$(echo "$TASK_NAME" | sed 's/ \[kind:[^]]*\]//' | sed 's/\[kind:[^]]*\] //' | sed 's/\[kind:[^]]*\]//')
else
  # Infer from subagent type
  case "$SUBAGENT_TYPE" in
    *code-reviewer*|*reviewer*)
      TASK_KIND="evaluation" ;;
    *architect*|*planner*|*Plan*)
      TASK_KIND="planning" ;;
    *)
      TASK_KIND="work" ;;
  esac
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

NEW_TASK=$(jq -n \
  --arg id "$TASK_ID" \
  --arg name "$TASK_NAME" \
  --arg agent "$SUBAGENT_TYPE" \
  --arg now "$NOW" \
  --arg parentId "$PARENT_ID" \
  --arg sessionId "$SESSION_ID" \
  --arg skill "$ORIGINATING_SKILL" \
  --arg kind "$TASK_KIND" \
  --argjson dependencies "$DEPENDENCIES" \
  '{
    id: $id,
    name: $name,
    status: "running",
    agentType: $agent,
    parentId: (if $parentId == "" then null else $parentId end),
    sessionId: (if $sessionId == "" then null else $sessionId end),
    createdAt: $now,
    startedAt: $now,
    completedAt: null,
    progressPercentage: 0,
    logs: [
      { timestamp: $now, level: "info", message: ("Task started: " + $name) }
    ],
    events: [],
    dependencies: $dependencies,
    originatingSkill: (if $skill != "" then $skill else null end),
    taskKind: $kind
  }')

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d "$NEW_TASK")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "201" ]; then
  EXTRA=""
  [ -n "$PARENT_ID" ] && EXTRA="$EXTRA parentId=$PARENT_ID"
  [ "$DEPENDENCIES" != "[]" ] && EXTRA="$EXTRA dependsOn=$DEPENDS_RAW"
  log "OK: created task $TASK_ID (\"$TASK_NAME\", $SUBAGENT_TYPE$EXTRA)"
else
  log "ERROR: POST /tasks failed (HTTP $HTTP_CODE) — is json-server running on :3001?"
fi
