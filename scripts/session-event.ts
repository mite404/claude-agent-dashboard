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

import type { SessionEventType } from '../src/types/task';
import {
  buildSessionEvent,
  type ClaudeSessionEventPayload,
} from '../src/lib/sessionEventUtils.test';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

// stdin
export interface ClaudeSessionEventPayload {
  session_id: string;
  agent_id?: string;
  agent_type?: string;
  prompt?: string;
  model?: string;
  message?: string;
  notification_type?: string;
  tool_name?: string;
  error?: string;
  token_count?: number;
  reason?: string;
  task_title?: string;
  task_id?: string;
  file_path?: string;
  source?: string;
  branch?: string;
}

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

export function buildSessionEvent(
  eventType: string,
  payload: ClaudeSessionEventPayload,
  timestamp: string,
  sessionId: string,
): Record<string, any> {
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
      const model = payload.model ?? 'unknown';
      summary = model;
      extraFields = { model };
      break;
    }
    case 'Stop': {
      summary = 'session ended';
      extraFields = {};
      break;
    }
    case 'SubagentStart':
      summary = `agent ${agentId} started`;
      extraFields = {};
      break;
    case 'SubagentStop': {
      summary = `agent ${agentId} finished`;
      extraFields = {};
      break;
    }
    case 'Notification': {
      const message = payload.message ?? '';
      const notificationType = payload.notification_type ?? '';
      summary = `${notificationType}: ${message.slice(0, 80)}`;
      extraFields = { message, notificationType };
      break;
    }
    case 'PermissionRequest': {
      const tool = payload.tool_name ?? 'unknown';
      summary = `${tool} requested`;
      extraFields = { toolName: tool };
      break;
    }
    case 'PreCompact': {
      const tokenCount = payload.token_count ?? null;
      summary = tokenCount
        ? `content compaction (${tokenCount} tokens)`
        : `context compaction triggered`;
      extraFields = { tokenCount };
      break;
    }
    case 'PostToolUseFailure': {
      const tool = payload.tool_name ?? 'unknown';
      const error = payload.error ?? '';
      summary = `${tool} failed: ${error.slice(0, 80)}`;
      extraFields = { toolName: tool, error };
      break;
    }
    case 'SessionEnd': {
      const reason = payload.reason ?? 'unknown';
      summary = `session ended: ${reason}`;
      extraFields = { reason };
      break;
    }
    case 'TeammateIdle': {
      summary = `teammate ${agentId} idle`;
      extraFields = {};
      break;
    }
    case 'TaskCompleted': {
      const taskTitle = payload.task_title ?? payload.task_id ?? 'unknown';
      summary = `task completed: ${taskTitle.slice(0, 80)}`;
      extraFields = { taskTitle };
      break;
    }
    case 'InstructionsLoaded': {
      const filePath = payload.file_path ?? 'unknown';
      const source = payload.source ?? 'unknown';
      summary = `instructions loaded: ${filePath}`;
      extraFields = { filePath, source };
      break;
    }
    case 'ConfigChange': {
      const filePath = payload.file_path ?? 'unknown';
      const source = payload.source ?? 'unknown';
      summary = `config changed: ${filePath} (${source})`;
      extraFields = { filePath, source };
      break;
    }
    case 'WorktreeCreate': {
      const branch = payload.branch ?? 'unknown';
      summary = `worktree created: ${branch}`;
      extraFields = { branch };
      break;
    }
    case 'WorktreeRemove': {
      const branch = payload.branch ?? 'unknown';
      summary = `worktree removed: ${branch}`;
      extraFields = { branch };
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
const sessionEvent = buildSessionEvent(eventType, payload, timestamp, sessionId);

const httpCode = await retryPost(`${API_BASE}/sessionEvents`, sessionEvent);

if (httpCode === 201) {
  await log(`OK: ${eventType} - ${sessionEvent.summary}`);
} else {
  await log(`ERROR: POST /sessionEvents failed (HTTP ${httpCode})`);
}
