import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from './db/index';
import { tasksTable, sessionEventsTable, sessionsTable } from './db/schema';

const app = new Hono();

// parse stored JSON text back to array on every task row
function parseTasks(rows: (typeof tasksTable.$inferSelect)[]) {
  return rows.map((t) => ({
    ...t,
    logs: JSON.parse(t.logs ?? '[]'),
    events: JSON.parse(t.events ?? '[]'),
    dependencies: JSON.parse(t.dependencies ?? '[]'),
  }));
}

function serializeTask(task: Record<string, unknown>) {
  return {
    ...task,
    logs: task.logs ? JSON.stringify(task.logs) : '[]',
    events: task.events ? JSON.stringify(task.events) : '[]',
    dependencies: task.dependencies ? JSON.stringify(task.dependencies) : '[]',
  };
}

const VALID_STATUSES = [
  'unassigned',
  'claimed',
  'running',
  'completed',
  'failed',
  'paused',
  'cancelled',
  'blocked',
];

// GET /tasks - list all, optionally filtered by ?status or ?sessionId
app.get('/tasks', async (c) => {
  const status = c.req.query('status');
  const sessionId = c.req.query('sessionId');
  console.log('GET /tasks called with:', { status, sessionId });

  if (!status || !sessionId) {
    return c.json({ error: 'status and sessionId required' }, 400);
  }

  if (!VALID_STATUSES.includes(status)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.status, status), eq(tasksTable.sessionId, sessionId)));

  console.log('Query returned:', rows.length, 'rows');
  return c.json({ data: rows });
});

// GET /tasks/:id
app.get('/tasks/:id', async (c) => {
  const id = c.req.param('id');

  if (!id) {
    return c.json({ error: 'id required' }, 400);
  }

  const rows = await db.select().from(tasksTable).where(eq(tasksTable.id, id));

  const task = rows[0];

  if (!task) {
    return c.json({ error: 'task not found' }, 404);
  }

  return c.json({ task });
});

// POST /tasks - called by pre-tool-agent.sh
app.post('/tasks', async (c) => {
  const body = await c.req.json();

  // TODO: serializeTask(body) before inserting
  const result = await db
    .insert(tasksTable)
    .values({
      id: crypto.randomUUID(),
      name: body.name,
      sessionId: body.sessionId,
      status: 'unassigned',
      createdAt: new Date().toISOString(),
    })
    .returning(); // returns an array of props

  // TODO: db.insert(tasksTable).values(...).returning()

  // TODO: return parseTasks(result)[0] with status 201
  const task = parseTasks(result)[0];
  return c.json({ task }, 201);
});

app.get('/debug/sessions', async (c) => {
  const sessions = await db.select().from(sessionsTable);

  return c.json({ sessions });
});

const PORT = parseInt(Bun.env.PORT || '3000');

export default {
  fetch: app.fetch,
  port: PORT,
};
