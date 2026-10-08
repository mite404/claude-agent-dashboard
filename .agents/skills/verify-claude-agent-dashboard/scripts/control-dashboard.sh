#!/usr/bin/env bash
# Launch/doctor/stop helper for Claude Agent Dashboard verification runs.
# Starts Vite (:5173) and Hono (:3001) without hook log tail or terminal spawn.

set -euo pipefail

# ---------------------------------------------------------------- CONFIG
APP="claude-agent-dashboard"
DEFAULT_VITE_PORT="${VERIFY_VITE_PORT:-5173}"
DEFAULT_HONO_PORT="${VERIFY_HONO_PORT:-3001}"
READY_PATH="/"
DOCTOR_NEEDLE="Claude Agent Dashboard"
BOOT_TIMEOUT=60
# ------------------------------------------------------------- END CONFIG

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
STATE_DIR="${VERIFY_STATE_DIR:-/tmp/${APP}-verify-${VERIFY_RUN_ID:-default}}"
VITE_PID_FILE="$STATE_DIR/vite.pid"
HONO_PID_FILE="$STATE_DIR/hono.pid"
VITE_PORT_FILE="$STATE_DIR/vite.port"
HONO_PORT_FILE="$STATE_DIR/hono.port"
VITE_LOG="$STATE_DIR/vite.log"
HONO_LOG="$STATE_DIR/hono.log"

mkdir -p "$STATE_DIR"

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    curl -fsS "http://127.0.0.1:${1}${READY_PATH}" >/dev/null 2>&1
  fi
}

read_vite_port() { [[ -f "$VITE_PORT_FILE" ]] && cat "$VITE_PORT_FILE" || echo "$DEFAULT_VITE_PORT"; }
read_hono_port() { [[ -f "$HONO_PORT_FILE" ]] && cat "$HONO_PORT_FILE" || echo "$DEFAULT_HONO_PORT"; }

pid_running() {
  [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null
}

cmd_launch() {
  local vite_port="${VERIFY_VITE_PORT:-$DEFAULT_VITE_PORT}"
  local hono_port="${VERIFY_HONO_PORT:-$DEFAULT_HONO_PORT}"

  if pid_running "$VITE_PID_FILE" || pid_running "$HONO_PID_FILE"; then
    echo "$APP: already running (state $STATE_DIR)" >&2
    exit 1
  fi
  if port_in_use "$vite_port"; then
    echo "$APP: Vite port $vite_port already in use — set VERIFY_VITE_PORT" >&2
    exit 1
  fi
  if port_in_use "$hono_port"; then
    echo "$APP: Hono port $hono_port already in use — set VERIFY_HONO_PORT" >&2
    exit 1
  fi

  echo "$vite_port" >"$VITE_PORT_FILE"
  echo "$hono_port" >"$HONO_PORT_FILE"
  cd "$ROOT"

  PORT="$hono_port" bun src/server.ts >"$HONO_LOG" 2>&1 &
  echo $! >"$HONO_PID_FILE"

  bunx vite --host 127.0.0.1 --port "$vite_port" >"$VITE_LOG" 2>&1 &
  echo $! >"$VITE_PID_FILE"

  for _ in $(seq 1 "$BOOT_TIMEOUT"); do
    if curl -fsS "http://127.0.0.1:${hono_port}/tasks" >/dev/null 2>&1 \
      && curl -fsS "http://127.0.0.1:${vite_port}${READY_PATH}" >/dev/null 2>&1; then
      echo "$APP: ready"
      echo "  vite: http://127.0.0.1:${vite_port}/ (pid $(cat "$VITE_PID_FILE"))"
      echo "  hono: http://127.0.0.1:${hono_port}/tasks (pid $(cat "$HONO_PID_FILE"))"
      echo "  state: $STATE_DIR"
      exit 0
    fi
    sleep 1
  done

  echo "$APP: timed out waiting for Vite + Hono" >&2
  tail -20 "$HONO_LOG" >&2 || true
  tail -20 "$VITE_LOG" >&2 || true
  exit 1
}

cmd_doctor() {
  local vite_port hono_port body
  vite_port="$(read_vite_port)"
  hono_port="$(read_hono_port)"

  [[ -f "$VITE_PID_FILE" ]] || {
    echo "$APP doctor: FAIL — no Vite pid file (run launch first)" >&2
    exit 1
  }
  [[ -f "$HONO_PID_FILE" ]] || {
    echo "$APP doctor: FAIL — no Hono pid file (run launch first)" >&2
    exit 1
  }
  pid_running "$VITE_PID_FILE" || {
    echo "$APP doctor: FAIL — Vite pid $(cat "$VITE_PID_FILE") is not running" >&2
    exit 1
  }
  pid_running "$HONO_PID_FILE" || {
    echo "$APP doctor: FAIL — Hono pid $(cat "$HONO_PID_FILE") is not running" >&2
    exit 1
  }
  port_in_use "$vite_port" || {
    echo "$APP doctor: FAIL — nothing listening on Vite port $vite_port" >&2
    exit 1
  }
  port_in_use "$hono_port" || {
    echo "$APP doctor: FAIL — nothing listening on Hono port $hono_port" >&2
    exit 1
  }

  body="$(curl -fsS "http://127.0.0.1:${vite_port}${READY_PATH}")" || {
    echo "$APP doctor: FAIL — GET $READY_PATH did not return 200" >&2
    exit 1
  }
  grep -q "$DOCTOR_NEEDLE" <<<"$body" || {
    echo "$APP doctor: FAIL — page missing title ($DOCTOR_NEEDLE)" >&2
    exit 1
  }

  curl -fsS "http://127.0.0.1:${hono_port}/tasks" | grep -q '^\[' || {
    echo "$APP doctor: FAIL — GET /tasks did not return a JSON array" >&2
    exit 1
  }

  echo "$APP doctor: OK"
  echo "  vite: http://127.0.0.1:${vite_port}/"
  echo "  hono: http://127.0.0.1:${hono_port}/tasks"
  echo "  state: $STATE_DIR"
}

stop_pid_file() {
  local label="$1" pid_file="$2"
  [[ -f "$pid_file" ]] || return 0
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    echo "$APP: stopped $label pid $pid"
  else
    echo "$APP: $label pid $pid was not running"
  fi
  rm -f "$pid_file"
}

cmd_stop() {
  stop_pid_file "Vite" "$VITE_PID_FILE"
  stop_pid_file "Hono" "$HONO_PID_FILE"
}

case "${1:-}" in
  launch) cmd_launch ;;
  doctor) cmd_doctor ;;
  stop) cmd_stop ;;
  *) echo "usage: $(basename "$0") {launch|doctor|stop}" >&2; exit 1 ;;
esac
