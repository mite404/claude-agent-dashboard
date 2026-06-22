#!/opt/homebrew/bin/bun
/**
 * Agent Lifecycle Simulator — Kanban Board Smoke Test
 *
 * Simulates a realistic Claude Code agent run to fill every dashboard surface:
 *   - Kanban columns (unassigned, claimed, running, blocked, paused, done)
 *   - Session events log (SessionStart, SubagentStart, SubagentStop, etc.)
 *   - Parent-child task tree
 *   - Task claim + status transitions
 *
 * Usage (while `bun run dev` is running):
 *   bun scripts/simulate-agent.ts
 */

const API_BASE = 'http://localhost:3001';
const LOG_FILE = `${process.cwd()}/logs/hooks.log`;

const SESSION_ID = crypto.randomUUID();
const AGENT_ID = crypto.randomUUID();
const PARENT_TASK_ID = crypto.randomUUID();
const CHILD_TASK_ID = crypto.randomUUID();
const CLAIMED_TASK_ID = crypto.randomUUID();
const COMPLETED_TASK_ID = crypto.randomUUID();
const FAILED_TASK_ID = crypto.randomUUID();
const PAUSED_TASK_ID = crypto.randomUUID();
const BLOCKED_TASK_ID = crypto.randomUUID();
const DEPENDENCY_TASK_ID = crypto.randomUUID();

// Ensure sessions row exists first (POST /tasks auto-upserts, but events need it too)
async function ensureSession(sessionId: string) {
  await fetch(`${API_BASE}/sessionEvents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      type: 'SessionStart',
      summary: 'claude-sonnet-4',
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
    }),
  });
}

async function log(msg: string) {
  const timeStr = `[${new Date().toISOString().slice(0, 19)}Z]`;
  const line = `[${timeStr}] [simulator] ${msg}\n`;
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
  console.log(`[simulator] ${msg}`);
}

async function post(url: string, body: object) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `""`);
    throw new Error(`${url} failed (HTTP ${res.status}): ${text}`);
  }
  return res.json();
}

async function patch(url: string, body: object) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `""`);
    throw new Error(`${url} failed (HTTP ${res.status}): ${text}`);
  }
  return res.json();
}

async function sendEvent(type: string, overrides: object = {}) {
  const payload = {
    sessionId: SESSION_ID,
    type,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
  await post('/sessionEvents', payload);
}

// ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Agent Lifecycle Simulator ===');
  console.log(`Session ID: ${SESSION_ID}\n`);

  // Seed the session
  await ensureSession(SESSION_ID);
  await log('Session started');

  // ── 1. Session-level lifecycle events ──────────────────────────
  await sendEvent('UserPromptSubmit', {
    summary: 'Create a kanban board for task management',
    prompt: 'Create a kanban board for task management',
    originatingSkill: '/prototype',
  });
  await log('UserPromptSubmit sent');

  await sendEvent('SessionStart', {
    summary: 'claude-sonnet-4',
    model: 'claude-sonnet-4',
  });
  await log('SessionStart sent');

  await sendEvent('InstructionsLoaded', {
    summary: 'instructions loaded: docs/FOR_ETHAN.md',
    filePath: 'docs/FOR_ETHAN.md',
    source: 'project_docs',
  });
  await log('InstructionsLoaded sent');

  await sendEvent('SubagentStart', {
    summary: `agent ${AGENT_ID} started`,
    agentId: AGENT_ID,
    agentType: 'general-purpose',
  });
  await log('SubagentStart sent — agent initialized!');

  // ── 2. Task creation (fills Kanban columns) ────────────────────

  // Parent task → orchestrator on the board
  await post('/tasks', {
    id: PARENT_TASK_ID,
    name: 'Implement Kanban board UI',
    status: 'running',
    agentType: 'general-purpose',
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    progressPercentage: 35,
    priority: 'high',
    kind: 'work',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    logs: [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Task started: Implement Kanban board UI',
      },
    ],
  });
  await log(`Created parent task (running): ${PARENT_TASK_ID}`);

  // Child task → blocked because it depends on parent
  await post('/tasks', {
    id: CHILD_TASK_ID,
    name: 'Add drag-and-drop to Kanban',
    status: 'pending',
    agentType: 'general-purpose',
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    parentId: PARENT_TASK_ID,
    dependencies: [PARENT_TASK_ID],
    progressPercentage: 0,
    priority: 'normal',
    kind: 'work',
    createdAt: new Date().toISOString(),
    logs: [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Task created: Add drag-and-drop to Kanban',
      },
    ],
  });
  await log(`Created child task (blocked by parent): ${CHILD_TASK_ID}`);

  // Unassigned task → appears in Unassigned column
  await post('/tasks', {
    id: crypto.randomUUID(),
    name: 'Write E2E tests for task board',
    status: 'unassigned',
    sessionId: SESSION_ID,
    progressPercentage: 0,
    priority: 'normal',
    kind: 'evaluation',
    createdAt: new Date().toISOString(),
  });
  await log('Created unassigned task');

  // Claimed task → appears in Claimed column
  await post('/tasks', {
    id: CLAIMED_TASK_ID,
    name: 'Refactor auth middleware tests',
    status: 'claimed',
    sessionId: SESSION_ID,
    claimedBy: 'manual-12345',
    claimedAt: new Date().toISOString(),
    progressPercentage: 10,
    priority: 'high',
    kind: 'work',
    createdAt: new Date().toISOString(),
  });
  await log(`Created claimed task: ${CLAIMED_TASK_ID}`);

  // Completed task → Done column
  await post('/tasks', {
    id: COMPLETED_TASK_ID,
    name: 'Set up Drizzle ORM schema',
    status: 'completed',
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    progressPercentage: 100,
    priority: 'normal',
    kind: 'planning',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date().toISOString(),
    logs: [
      {
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        level: 'info',
        message: 'Task started: Set up Drizzle ORM schema',
      },
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Task completed: schema finalized',
      },
    ],
  });
  await log(`Created completed task: ${COMPLETED_TASK_ID}`);

  // Failed task → Done column (completed | cancelled | failed)
  await post('/tasks', {
    id: FAILED_TASK_ID,
    name: 'Migrate legacy data to SQLite',
    status: 'failed',
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    progressPercentage: 0,
    priority: 'urgent',
    kind: 'work',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    startedAt: new Date(Date.now() - 7200000).toISOString(),
    completedAt: new Date().toISOString(),
    logs: [
      {
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        level: 'info',
        message: 'Task started: Migrate legacy data to SQLite',
      },
      {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Task failed: FOREIGN KEY constraint failed',
      },
    ],
  });
  await log(`Created failed task: ${FAILED_TASK_ID}`);

  // Paused task → Paused column
  await post('/tasks', {
    id: PAUSED_TASK_ID,
    name: 'Design dark mode palette',
    status: 'paused',
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    progressPercentage: 60,
    priority: 'low',
    kind: 'work',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    startedAt: new Date(Date.now() - 1800000).toISOString(),
    logs: [
      {
        timestamp: new Date(Date.now() - 1800000).toISOString(),
        level: 'info',
        message: 'Task started: Design dark mode palette',
      },
      {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Task paused: waiting for design review',
      },
    ],
  });
  await log(`Created paused task: ${PAUSED_TASK_ID}`);

  // Blocked task (with dependency not yet complete)
  await post('/tasks', {
    id: DEPENDENCY_TASK_ID,
    name: 'Prerequisite: Fix tailwind config',
    status: 'running',
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    progressPercentage: 20,
    priority: 'high',
    kind: 'work',
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  });
  await log(`Created dependency task (running): ${DEPENDENCY_TASK_ID}`);

  await post('/tasks', {
    id: BLOCKED_TASK_ID,
    name: 'Build out color tokens',
    status: 'pending',
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    dependencies: [DEPENDENCY_TASK_ID],
    progressPercentage: 0,
    priority: 'normal',
    kind: 'work',
    createdAt: new Date().toISOString(),
  });
  await log(`Created blocked task (depends on ${DEPENDENCY_TASK_ID}): ${BLOCKED_TASK_ID}`);

  // ── 3. More session events ─────────────────────────────────────
  await sendEvent('PermissionRequest', {
    summary: 'Bash requested',
    toolName: 'Bash',
  });
  await log('PermissionRequest sent');

  await sendEvent('Notification', {
    summary: 'info: Task completed successfully',
    message: 'Task completed successfully',
    notificationType: 'info',
  });
  await log('Notification sent');

  await sendEvent('SubagentStop', {
    summary: `agent ${AGENT_ID} finished`,
    agentId: AGENT_ID,
    agentType: 'general-purpose',
  });
  await log('SubagentStop sent');

  await sendEvent('SessionEnd', {
    summary: 'session ended: user_request',
    reason: 'user_request',
  });
  await log('SessionEnd sent');

  // ── 4. Mark the parent task completed (so blocked child becomes unblocked) ──
  await patch(`/tasks/${PARENT_TASK_ID}`, {
    status: 'completed',
    progressPercentage: 100,
    completedAt: new Date().toISOString(),
  });
  await log(`Parent task ${PARENT_TASK_ID} marked completed`);

  console.log('\n=== Simulator complete ===');
  console.log(`Session: ${SESSION_ID}`);
  console.log(`Agent:   ${AGENT_ID}`);
  console.log(`\nCheck the dashboard at http://localhost:5173`);
}

main().catch(async (err) => {
  console.error(err.message);
  await log(`ERROR: ${err.message}`);
  process.exit(1);
});
