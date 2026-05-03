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

import { buildSessionEvent, type ClaudeSessionEventPayload } from '@/lib/SessionEventUtils';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

// TODO parse
const raw = await Bun.stdin.text();
const payload: ClaudeSessionEventPayload = JSON.parse(raw);
const sessionId = (payload.session_id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');

// log fn
async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`; // YYYY-MM-DDTHH:MM:SS
  const line = `[${timeStr}] [session] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}

await log(`started sessionId: ${sessionId}`);

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

const timestamp = new Date().toISOString();
const sessionEvent = buildSessionEvent(eventType, payload, timestamp, sessionId);

const httpCode = await retryPost(`${API_BASE}/sessionEvents`, sessionEvent);

if (httpCode === 201) {
  await log(`OK: ${eventType} - ${sessionEvent.summary}`);
} else {
  await log(`ERROR: POST /sessionEvents failed (HTTP ${httpCode})`);
}
