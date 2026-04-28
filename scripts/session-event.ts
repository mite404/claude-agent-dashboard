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

import type { Task, SessionEvent, SessionEventType } from '../src/types/task';

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

function buildSessionEvent(
  eventType: string,
  payload: ClaudeSessionEventPayload,
  timestamp: string,
  sessionId: string,
): Promise<Partial<SessionEventType>> {
  const agentId = payload.agent_id ?? '';
  const agentType = payload.agent_type ?? '';
  let summary = '';
  let extraFields: Record<string, any> = {};

  switch (eventType) {
    case 'UserPromptSubmit': {
      const prompt = payload.prompt ?? '';
      summary = prompt.slice(0, 100);
      extraFields = { prompt };
      break;
    }
    case 'SessionStart': {
      // TODO(human): extract model, build summary, populate extraFields
      const model = payload.model ?? 'unknown';
      const summary = `${model}`;
      const extraFields = { model: ${model} }
      break;
    }
    case 'Stop': {
      const summary = 'session ended'
      const extraFields = {}
    }
    case 'SubagentStart': {
      const summary = `agent ${agentId} started`
      const extraFields = {}
    }
    case 'SubagentStop': {


    }
    case 'Notification': {
      const message = payload.message ?? '';
      const notifType = payload.notification_type ?? '';
      const summary = `${notifType}: ${message}`;
      const extraFields = { message: ${message}, notificationType: ${notifType} };
    }
    case 'PermissionRequest': {
      const tool = payload.tool_name ?? 'unknown';
      const summary = `${tool} requested`;
      const extraFields = { toolName: ${tool} };
    }
    case 'PreCompact': {
      const tokenCount = payload.token_count ?? null;
      const summary = tokenCount
        ? `content compaction (${tokenCount} tokens)`
        : `context compaction triggered`;
      const extraFields = { tokenCount };
      break;
    }
    case 'PostToolUseFailure': {
      const tool = payload.tool_name ?? 'unknown';
      const error = payload.error ?? '';
      const summary = `${tool} failed: ${error}`;
      const extraFields = { toolName: ${tool}, error: ${error} };
    }
    case 'SessionEnd': {
      const reason = payload.reason ?? 'unknown';
      const summary = `session endeded: ${reason}`;
      const extraFields = { reason: ${reason} };
    }
    case 'TeammateIdle': {
      const summary = payload.
      const extraFields = {};
    }
    case 'TaskCompleted': {
      const taskTitle = payload.task_title ?? payload.task_id ?? 'unknown';
      const summary = `task completed: ${taskTitle.slice(0, 80)}`;
      const extraFields = { taskTitle };
      break;
    }
    case 'InstructionsLoaded': {
      const filePath = payload.filePath ?? 'unknown';
      const source = payload.source ?? 'unknown';
      const summary = `instructions loaded: ${filePath}`;
      const extraFields = { filePath, source };
      break;
    }
    case 'ConfigChange': {
      const filePath = payload.filePath ?? 'unknown';
      const source = payload.source ?? 'unknown';
      const summary = `instructions loaded: ${filePath}`;
      const extraFields = { filePath, source };
      break;
    }
    case 'WorktreeCreate': {
      const filePath = payload.filePath ?? 'unknown';
      const source = payload.source ?? 'unknown';
      const summary = `instructions loaded: ${filePath}`;
      const extraFields = { filePath, source };
      break;
    }
    case 'WorktreeRemove': {
      const filePath = payload.filePath ?? 'unknown';
      const source = payload.source ?? 'unknown';
      const summary = `instructions loaded: ${filePath}`;
      const extraFields = { filePath, source };
      break;
    }
    default:
      summary = eventType;
      extraFields = {};
  }
  return {
    type: eventType,
    timestamp,
    sessionId,
    summary,
    ...(agentId && { agentId }),
    ...(agentType && { agentType }),
    ...extraFields,
  };
}

const timestamp = new Date().toISOString();
const sessionEvent = await buildSessionEvent(eventType, payload, timestamp, sessionId);

const httpCode = await retryPost(`${API_BASE}/sessionEvents`, sessionEvent);

if (httpCode === 201) {
  await log(`OK: ${eventType} - ${sessionEvent.summary}`);
} else {
  await log(`ERROR: POST /sessionEvents failed (HTTP ${httpCode})`);
}
