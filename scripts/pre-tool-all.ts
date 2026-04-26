#!/opt/homebrew/bin/bun

// Claude Code PreToolUse hook — fires on ALL tools (empty matcher).
// For non-Agent tools, finds the running task for this session and appends
// a pre-event to its events array. Agent tool calls are skipped here
// (handled by pre-tool-agent.sh via the "Agent" matcher).
//
// Hook stdin fields used:
//   .session_id    → used to find the parent running task
//   .tool_name     → Bash, Read, Write, Edit, Grep, Glob, etc.
//   .tool_use_id   → event id
//   .tool_input    → summarized for display
import type { Task, HookEvent } from '../src/types/task';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

// what Claude sends via stdin
interface ClaudePreToolPayload {
  session_id: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, any>;
  agent_id?: string;
}

// stdin parsing
const raw = await Bun.stdin.text();
const payload: ClaudePreToolPayload = JSON.parse(raw);

const toolName = payload.tool_name ?? '';
const eventId = payload.tool_use_id ?? 'unknown';
const agentId = payload.agent_id ?? '';
const sessionId = (payload.session_id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');

// log fn
async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`; // YYYY-MM-DDTHH:MM:SS
  const line = `[${timeStr}] [post-all] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}

//

if (!sessionId) {
  await log(`SKIP: no session_id in hook payload for ${toolName} (${eventId})`);
  process.exit(0);
}

let existing: Task | null = null;
let lookupMethod: string;

if (agentId) {
  const res = await fetch(`${API_BASE}/tasks/${agentId}`);
  existing = res.ok ? ((await res.json()) as Task) : null;
  lookupMethod = 'agent_id';
} else {
  const res = await fetch(`${API_BASE}/tasks?sessionId=${sessionId}`);
  if (res.ok) {
    const all = (await res.json()) as Array<Task>;
    existing = all.find((t) => t.status === 'running') ?? null;
  }
  lookupMethod = 'sessionId';
}

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

const event: HookEvent = {
  id: payload.tool_use_id,
  toolName: payload.tool_name,
  phase: 'pre',
  status: 'running',
  summary: extractSummary(payload.tool_name, payload.tool_input),
  timestamp: new Date().toISOString(),
};
