#!/opt/homebrew/bin/bun

// Claude Code PostToolUse hook — fires on ALL tools (empty matcher).
// Also handles PostToolUseFailure for non-Agent tools.
// Finds the matching pre-event in the parent task and marks it completed/failed.
//
// Hook stdin fields used:
//    .session_id           → used to find the parent running task
//    .tool_name            → used to skip Agent calls
//    .tool_use_id          → matches the pre-event by id
//    .tool_response        → is_error flag
import type { Task } from '../src/types/task';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

// stdin payload
interface PostToolAllPayload {
  tool_name?: string;
  tool_use_id?: string;
  agent_id?: string;
  session_id?: string;
  tool_response?: { is_error?: boolean };
  tool_result?: { is_error?: boolean };
}

// stdin parsing
const raw = await Bun.stdin.text();
const payload: PostToolAllPayload = JSON.parse(raw);

const toolName = payload.tool_name ?? ''; // what tool was it?
const eventId = payload.tool_use_id ?? 'unknown'; // which event fired?
const agentId = payload.agent_id ?? ''; // optional: if subagent
const sessionId = (payload.session_id ?? '').replace(/[^a-zA-Z0-9_-]/g, ''); // what session was it?

// normalize the 2 possible result field names into 1 var
const result = payload.tool_response ?? payload.tool_result ?? {};
const isError = result.is_error ?? false;
const now = new Date().toISOString();

const finalStatus = isError ? 'failed' : 'completed';

async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`; // YYYY-MM-DDTHH:MM:SS
  const line = `[${timeStr}] [post-all] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}

if (toolName === 'Agent' || toolName === 'Task') {
  process.exit(0);
}

if (!sessionId) {
  await log(`SKIP: no session_id in hook payload for ${toolName} (${eventId})`);
  process.exit(0);
}

let existing: Task | null = null;
let lookupMethod: string;

if (agentId) {
  // which task owns this event?
  // subagent context: agent_id IS the task_id - one fetch
  const res = await fetch(`${API_BASE}/tasks?agentId=${agentId}`);
  const all = res.ok ? ((await res.json()) as Array<Task>) : [];
  existing = all[0] ?? null;
  lookupMethod = 'agent_id';
} else {
  // main session: no direct id, scan all tasks for this session
  const res = await fetch(`${API_BASE}/tasks?sessionId=${sessionId}`);
  if (res.ok) {
    const all = (await res.json()) as Array<Task>;
    existing = all.find((t) => t.status === 'running' || t.status === 'paused') ?? null;
  }
  lookupMethod = 'sessionId';
}

if (!existing) {
  await log(`SKIP: no active task found for ${toolName} (${eventId}) [via ${lookupMethod}]`);
  process.exit(0);
}

const events =
  ((existing as unknown as Record<string, unknown>).events as Array<Record<string, unknown>>) ?? [];

const updatedEvents = events.map((e) =>
  e.id === eventId ? { ...e, phase: 'post', status: finalStatus, completedAt: now } : e,
);

const taskId = existing.id;

if (existing) {
  const patch = {
    ...existing,
    events: updatedEvents,
  };

  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  if (res.ok) {
    await log(`OK: updated event ${toolName} -> ${finalStatus}`);
  } else {
    await log(`ERROR: PATCH /tasks/${taskId} failed (HTTP ${res.status}) for event ${eventId}`);
  }
}
