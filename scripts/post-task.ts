#!/opt/homebrew/bin/bun
import { Task, TaskPriority } from '../src/types/task';

const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';

const taskName = process.argv[2];
const description = process.argv[3];
const sessionId = process.argv[4] ?? process.env.CLAUDE_SESSION_ID ?? '';

const VALID: Array<TaskPriority> = ['low', 'normal', 'high', 'urgent'];
const raw = process.argv[5] ?? 'normal';
const priority: TaskPriority = VALID.includes(raw as TaskPriority)
  ? (raw as TaskPriority)
  : 'normal';

if (!sessionId) {
  console.error('Error: sessionId required (pass as 4th arg or set CLAUDE_SESSION_ID env var)');
  process.exit(1);
}

const post: Partial<Task> = {
  name: taskName,
  description,
  status: 'unassigned',
  sessionId,
  priority,
  agentType: 'manual',
  createdAt: new Date().toISOString(),
};

const res = await fetch(`${API_BASE}/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(post),
});

const data = await res.json();
const taskId = data.id;

if (res.ok) {
  await log(`[post-task] Created task: ${taskId}`);
  console.log(taskId);
} else {
  await log(`ERROR: POST /tasks/${taskId} failed (HTTP ${res.status})`);
  process.exit(1);
}

async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`; // YYYY-MM-DDTHH:MM:SS
  const line = `[${timeStr}] [post-hook] ${msg}\n`;

  // append to log file if missing
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}
