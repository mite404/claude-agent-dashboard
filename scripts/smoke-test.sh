#!/bin/bash
# Smoke test for the Claude Agent Dashboard signal chain.
#
# Tests every link between Claude Code hooks and the dashboard UI:
#   1. json-server REST API is up on :3001
#   2. Vite dev server proxy is up on :5173
#   3. pre-hook creates a task as "running"
#   4. post-hook updates it to "completed" and appends a log entry
#   5. Task is visible through the Vite proxy (/api/tasks)
#   6. Cleanup (deletes the test task)
#
# If all steps pass: the app is healthy. Agent tasks will appear in the dashboard.
# If steps 1-5 pass but you still don't see real agents: check your LLM provider
# or confirm ~/.claude/settings.json has the hooks wired.
#
# Usage:
#   bash scripts/smoke-test.sh
#   (Run while `bun run dev` is active in another terminal)

DASHBOARD_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRE_HOOK="$DASHBOARD_DIR/scripts/pre-tool-agent.sh"
POST_HOOK="$DASHBOARD_DIR/scripts/post-tool-agent.sh"

TEST_ID="smoke-test-$(date +%s)"
PASS=0
FAIL=0

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'
BOLD='\033[1m'

pass() { echo -e "  ${GREEN}✓${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; FAIL=$((FAIL + 1)); }
info() { echo -e "  ${YELLOW}→${RESET} $1"; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
  curl -s -X DELETE "http://localhost:3001/tasks/$TEST_ID" > /dev/null 2>&1
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Claude Agent Dashboard — Smoke Test${RESET}"
echo    "────────────────────────────────────"
info "Test task ID: $TEST_ID"

# ── Step 1: json-server ───────────────────────────────────────────────────────
header "Step 1: json-server (:3001)"

TASKS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/tasks)
if [ "$TASKS_RESPONSE" = "200" ]; then
  pass "GET /tasks → HTTP 200"
else
  fail "GET /tasks → HTTP $TASKS_RESPONSE (is json-server running? try: bun run dev)"
fi

# ── Step 2: Vite proxy ────────────────────────────────────────────────────────
header "Step 2: Vite proxy (:5173)"

VITE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/api/tasks)
if [ "$VITE_RESPONSE" = "200" ]; then
  pass "GET /api/tasks via Vite proxy → HTTP 200"
else
  fail "GET /api/tasks via Vite proxy → HTTP $VITE_RESPONSE (is Vite running? try: bun run dev)"
fi

# ── Step 3: pre-hook ─────────────────────────────────────────────────────────
header "Step 3: Pre-hook (task created as 'running')"

PRE_INPUT=$(jq -n \
  --arg id "$TEST_ID" \
  '{
    tool_use_id: $id,
    tool_input: {
      description: "Smoke test agent",
      subagent_type: "general-purpose",
      run_in_background: false
    }
  }')

echo "$PRE_INPUT" | bash "$PRE_HOOK"

TASK=$(curl -s "http://localhost:3001/tasks/$TEST_ID")
TASK_STATUS=$(echo "$TASK" | jq -r '.status // "missing"')
TASK_LOGS=$(echo "$TASK" | jq '.logs | length')

if [ "$TASK_STATUS" = "running" ]; then
  pass "Task created with status 'running'"
else
  fail "Expected status 'running', got '$TASK_STATUS'"
fi

if [ "$TASK_LOGS" -ge 1 ] 2>/dev/null; then
  pass "Task has $TASK_LOGS log entry(s)"
else
  fail "Task has no log entries (got: $TASK_LOGS)"
fi

# ── Step 4: post-hook ─────────────────────────────────────────────────────────
header "Step 4: Post-hook (task updated to 'completed')"

POST_INPUT=$(jq -n \
  --arg id "$TEST_ID" \
  '{
    tool_use_id: $id,
    tool_input: {
      description: "Smoke test agent",
      subagent_type: "general-purpose",
      run_in_background: false
    },
    tool_response: {
      content: [{ type: "text", text: "Smoke test completed successfully." }],
      is_error: false
    }
  }')

echo "$POST_INPUT" | bash "$POST_HOOK"

TASK=$(curl -s "http://localhost:3001/tasks/$TEST_ID")
TASK_STATUS=$(echo "$TASK" | jq -r '.status // "missing"')
TASK_PROGRESS=$(echo "$TASK" | jq -r '.progressPercentage // 0')
TASK_LOGS=$(echo "$TASK" | jq '.logs | length')
LAST_LOG=$(echo "$TASK" | jq -r '.logs[-1].message // ""')

if [ "$TASK_STATUS" = "completed" ]; then
  pass "Task updated to status 'completed'"
else
  fail "Expected status 'completed', got '$TASK_STATUS'"
fi

if [ "$TASK_PROGRESS" = "100" ]; then
  pass "progressPercentage = 100"
else
  fail "Expected progressPercentage=100, got $TASK_PROGRESS"
fi

if [ "$TASK_LOGS" -ge 2 ] 2>/dev/null; then
  pass "Log appended ($TASK_LOGS total entries) — last: \"$LAST_LOG\""
else
  fail "Log not appended (expected ≥2 entries, got $TASK_LOGS)"
fi

# ── Step 5: Vite proxy end-to-end ─────────────────────────────────────────────
header "Step 5: Task visible through Vite proxy"

PROXY_TASK=$(curl -s "http://localhost:5173/api/tasks/$TEST_ID")
PROXY_STATUS=$(echo "$PROXY_TASK" | jq -r '.status // "missing"')

if [ "$PROXY_STATUS" = "completed" ]; then
  pass "Task visible via Vite proxy with correct status"
else
  fail "Proxy returned unexpected status: '$PROXY_STATUS'"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "\n────────────────────────────────────"
TOTAL=$((PASS + FAIL))

if [ "$FAIL" = "0" ]; then
  echo -e "${GREEN}${BOLD}All $TOTAL checks passed.${RESET} The signal chain is healthy."
  echo ""
  echo "  If real agent tasks still aren't appearing in the dashboard, check:"
  echo "  1. ~/.claude/settings.json has PreToolUse + PostToolUse hooks wired"
  echo "  2. The hook paths in settings.json point to this project's scripts/"
  echo "  3. Claude Code is the active session (hooks only fire during tool use)"
  EXIT_CODE=0
else
  echo -e "${RED}${BOLD}$FAIL of $TOTAL checks failed.${RESET} Fix the issues above before testing with real agents."
  EXIT_CODE=1
fi

echo ""
exit $EXIT_CODE
