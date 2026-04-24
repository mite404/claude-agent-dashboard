#!/opt/homebrew/bin/bun

// did the agent succeed?
// was it a background task?
// does the task row exist yet?

import type { Task } from '../src/types/task';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

// stdin paylod
interface ToolResult {
  is_error?: boolean;
  last_assistant_message?: string;
  content?: string | Array<{ text?: string }>;
}

interface PostToolPayload {
  session_id: string;
  tool_use_id: string;
  tool_input: {
    description: string;
    subagent_type?: string;
    run_in_background?: boolean;
  };
  tool_response?: ToolResult;
  tool_result?: ToolResult;
}

// stdin parsing
const raw = await Bun.stdin.text();
const payload: PostToolPayload = JSON.parse(raw);
const {
  session_id: sessionId = '',
  tool_use_id: taskId = 'unknown',
  tool_input: {
    description: taskName = 'Unnamed task',
    subagent_type: subagentType = 'general-purpose',
    run_in_background: isBg = false,
  } = {},
} = payload;

// normalize the 2 possible result field names into 1 var
const result = payload.tool_response ?? payload.tool_result ?? {};
const isError = result.is_error ?? false;
const lastMsg = result.last_assistant_message ?? '';
const now = new Date().toISOString();

// caller can embed metadata directly in the task description string using bracket tags: [parentId:abc123]
// this parses metadata tags out of task name
const parentId = taskName.match(/\[parentId:([^\]]+)\]/)?.[1] ?? null;
const dependsOnRaw = taskName.match(/\[dependsOn:([^\]]+)\]/)?.[1] ?? '';
const dependsOn = dependsOnRaw ? dependsOnRaw.split(',').map((id) => id.trim()) : [];
const kind = taskName.match(/\[kind:([^\]]+)\]/)?.[1] ?? null;

// strip all three tags from the display name
const displayName = taskName.replace(/\s*\[(?:parentId|dependsOn|kind):[^\]]*\]/g, '').trim();

// background tasks: agent tool returns immediately but the agent is still running
// the SubagentStop event (session-event.sh) will mark it complete when actualy finished
if (isBg) {
  await log(`INFO: backgroiund task ${taskId} -- skipping status update (agent still running)`);
  process.exit(0);
}

const status = isError ? 'failed' : 'completed';
const progress = isError ? 0 : 100;

function extractSummary(result: ToolResult): string {
  // content of non consistent type
  // null/undefined
  if (typeof result.content === 'undefined') {
    return '';
  }
  // account for string
  if (typeof result.content === 'string') {
    return result.content;
  }
  // array of content blocks: [{ text: "..." }, ...]
  if (Array.isArray(result.content)) {
    return result.content[0]?.text ?? '';
  }
  return ''; // exhausted all known shapes of data
}

const summary = extractSummary(result);
const logMessage = `Task ${isError ? 'failed' : 'completed'}: ${summary}`;

const newLog = {
  timestamp: now,
  level: isError ? 'error' : 'info',
  message: logMessage,
};

async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`; // YYYY-MM-DDTHH:MM:SS
  const line = `[${timeStr}] [post-hook] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}

const existingRes = await fetch(`${API_BASE}/tasks/${taskId}`);
const existing = existingRes.ok ? ((await existingRes.json()) as Task) : null;

function inferKind(agentType: string): string {
  const lower = agentType.toLowerCase();
  if (lower.includes('code-reviewer') || lower.includes('reviewer')) {
    return 'evaluation';
  }
  if (lower.includes('architect') || lower.includes('planner') || lower.includes('plan')) {
    return 'planning';
  }
  return 'work';
}

// infer the kind of task if no [kind:...] tag was provided - derived from 'agent type name'
// this shapes the visual badge in dashboard
const finalKind = kind ?? inferKind(subagentType);
const safeSessId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');

/* Two temp files are written:
 -  /tmp/cc-agent-task-${safeSid} — stores taskId for the SubagentStart hook to read
 -  /tmp/cc-skill-${safeSid} — read to get the originating skill (written by session-event.sh)
*/
// write current taskId so SubagentStart hook can look it up to link child agents back 2 parent
// const parentFile = Bun.file(`/tmp/cc-agent-task-${safeSessId}`); // read from
// const parentId = (await parentFile.exists()) ? (await parentFile.text()).trim() : null;

// read the skill file
const skillFile = Bun.file(`/tmp/cc-skill-${safeSessId}`);
const originatingSkill = (await skillFile.exists()) ? (await skillFile.text()).trim() : null;

if (existing) {
  const patch = {
    status,
    completedAt: now,
    progressPercentage: progress,
    ...(sessionId && { sessionId }),
    ...(lastMsg && { lastAssistantMessage: lastMsg }),
    logs: [newLog],
  };

  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (res.ok) {
    await log(`OK: updated task ${taskId} -> ${status}`);
  } else {
    await log(`ERROR: PATCH /tasks/${taskId} failed (HTTP ${res.status})`);
  }
}

if (!existing) {
  const post = {
    id: taskId,
    name: displayName,
    status,
    completedAt: now,
    agentType: subagentType,
    parentId: parentId || null,
    dependsOn,
    sessionId,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    kind: finalKind,
    originatingSkill,
    logs: [newLog],
  };

  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(post),
  });

  if (res.ok) {
    await log(`OK: updated task ${taskId} -> ${status}`);
  } else {
    await log(`ERROR: PATCH /tasks/${taskId} failed (HTTP ${res.status})`);
  }
}
