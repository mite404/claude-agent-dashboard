#!/opt/homebrew/bin/bun

// Claude Code session-level event hook.
// Handles: UserPromptSubmit, SessionStart, Stop, SubagentStart, SubagentStop,
//          Notification, PermissionRequest, PreCompact, PostToolUseFailure
//
// Usage: session-event.sh --event-type TYPE
//
// Common hook stdin fields (always present):
//   .session_id         → links event to its Claude session
//   .agent_id           → present when hook fires inside a subagent
//   .agent_type         → agent name ("Explore", "general-purpose", etc.)
//
// Event-specific stdin fields:
//   .prompt             → UserPromptSubmit
//   .model              → SessionStart
//   .message            → Notification
//   .notification_type  → Notification
//   .tool_name          → PermissionRequest, PostToolUseFailure
//   .token_count        → PreCompact
//   .error              → PostToolUseFailure

import { randomUUIDv7, sleep } from 'bun';
import type { Task, SessionEvent } from '../src/types/task';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

// TODO stdin
interface ClaudeSessionEventPayload {
  type: string;
  session_id: string;
  timestamp: string;
  agent_id: string;
  agent_type: string;
  metadata: { prompt?: string; model?: string };
}

// TODO parse
const raw = await Bun.stdin.text();
const payload: ClaudeSessionEventPayload = JSON.parse(raw);

const type = payload.type ?? '';
const agentId = payload.agent_id ?? '';
const agentType = payload.agent_type;
const sessionId = (payload.session_id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
const timeStamp = payload.timestamp ?? '';

// log fn
async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`; // YYYY-MM-DDTHH:MM:SS
  const line = `[${timeStr}] [pre-all] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}

log(`[session] [sessionId: ${sessionId}`);

async function retryPost(url: string, data: Record<string, any>): Promise<number> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.status === 201) return 201;

      if (attempt < maxAttempts) {
        const backoffMs = 100 * attempt;
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        return res.status;
      }
    } catch (error) {
      if (attempt < maxAttempts) {
        const backoffMs = 100 * attempt;
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        throw error;
      }
    }
  }
  return 0; // unreachable, but statisfies return type
}

let eventType = '';
const args = process.argv.slice(2); // skip bun and script path

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--event-type') {
    eventType = args[i + 1];
    i++;
  }
}

if (!eventType) {
  await log(`ERROR: --event-type is required`);
  process.exit(1); // exit Bun/node process
}

const event_id = `${timeStamp}-usepromptsubmit-${crypto.randomUUID()}`;

if (eventType) {
  const eventReturnObj = {
    ...payload,
  };

  const res = await fetch(`${API_BASE}/sessionEvents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventReturnObj),
  });
}

// ?? is this section relevant ??
// ── Agent attribution ──────────────────────────────────────────────────────────
// Merge agentId + agentType into the event whenever they are present.
// For events fired inside a subagent (any type), this captures which agent
// generated the event. For main-session events, AGENT_FIELDS is empty {}.

// TODO POST /sessionEvents
// ── Build and POST the session event ──────────────────────────────────────────
