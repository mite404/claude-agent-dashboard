#!/opt/homebrew/bin/bun
import type { Task, TaskKind } from '../src/types/task';

interface PreToolPayload {
  session_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: {
    description?: string;
    subagent_type?: string;
    run_in_background?: boolean;
  };
}

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

const raw = await Bun.stdin.text();
const payload: PreToolPayload = JSON.parse(raw);
const {
  session_id: sessionId = '',
  tool_use_id: taskId = '',
  tool_name: rawName = 'Unnamed task',
  tool_input: { subagent_type: subagentType = 'general-purpose' } = {},
} = payload;

const parentId = rawName.match(/\[parentId:([^\]]+)\]/)?.[1] ?? null;
const dependsOnRaw = rawName.match(/\[dependsOn:([^\]]+)\]/)?.[1] ?? '';
const dependsOn = dependsOnRaw ? dependsOnRaw.split(',').map((id) => id.trim()) : [];
const kind = rawName.match(/\[kind:([^\]]+)\]/)?.[1] ?? null;

// strip all three tags from the display name
const displayName = rawName.replace(/\s*\[(?:parentId|dependsOn|kind):[^\]]*\]/g, '').trim();

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

// Only infer if no [kind:...] tag was found
const finalKind = kind ?? inferKind(subagentType);
const safeSessId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');

/* Two temp files are written:
 -  /tmp/cc-agent-task-${safeSid} — stores taskId for the SubagentStart hook to read
 -  /tmp/cc-skill-${safeSid} — read to get the originating skill (written by session-event.sh)
*/
// write task ID
await Bun.write(`/tmp/cc-agent-task-${safeSessId}`, taskId);

// read the skill file
const skillFile = Bun.file(`/tmp/cc-skill-${safeSessId}`);
const originatingSkill = (await skillFile.exists()) ? (await skillFile.text()).trim() : null;

const newTask = {
  id: taskId,
  name: displayName,
  status: 'running',
  agentType: subagentType,
  parentId: parentId || null,
  sessionId,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  kind,
  originatingSkill,
  logs: [
    {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Task started: ${displayName}`,
    },
  ],
};

const res = await fetch(`${API_BASE}/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(newTask),
});

const HTTP_CODE = res.status;

async function log(msg: string) {
  const timeStr = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const line = `[${timeStr}] [pre-hook] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);

  await log(`OK: created task ${newTask.id} ${newTask.name}`);
  await log(`ERROR: POST /tasks failed ${HTTP_CODE}`);
}
