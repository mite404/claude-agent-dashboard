import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from './db/index';
import { tasksTable, sessionEventsTable, sessionsTable } from './db/schema';

const app = new Hono();

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

// -- TASKS
// GET /tasks - list all, optionally filtered by ?status or ?sessionId
app.get('/tasks', async (c) => {
  const status = c.req.query('status');
  const sessionId = c.req.query('sessionId');

  console.log('GET /tasks called with:', { status: status, sessionId: sessionId });

  if (status && !VALID_STATUSES.includes(status)) {
    console.error('Invalid status:', { status, valid: VALID_STATUSES });
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
  }

  try {
    const conditions = [];
    if (status) conditions.push(eq(tasksTable.status, status));
    if (sessionId) conditions.push(eq(tasksTable.sessionId, sessionId));

    const rows = await db
      .select()
      .from(tasksTable)
      .where(conditions.length ? and(...conditions) : undefined);

    console.log('Query returned:', {
      count: rows.length,
      id: rows[0]?.id,
      status: rows[0]?.status,
    });

    return c.json({ data: rows });
  } catch (error) {
    console.error('Failed to get task:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// GET /tasks/:id
app.get('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  console.log('GET task for id:', id);

  if (!id) {
    return c.json({ error: 'id required' }, 400);
  }

  try {
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    console.log('Query returned:', {
      count: rows.length,
      id: rows[0]?.id,
      status: rows[0]?.status,
    });
    const task = rows[0];

    if (!task) {
      console.error('Task not found:', id);
      return c.json({ error: 'task not found' }, 404);
    }

    return c.json({ task });
  } catch (error) {
    console.error('Failed to get task:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// POST /tasks - called by pre-tool-agent.sh
app.post('/tasks', async (c) => {
  let body;

  try {
    body = await c.req.json();
  } catch (error) {
    console.error('Malformed JSON response', error);
    return c.json({ error: 'Bad request' }, 400);
  }

  console.log('POST /tasks has been called with:', { name: body.name, sessionId: body.sessionId });

  if (!body.name || !body.sessionId) {
    console.error('Missing required name and sessionId:', {
      hasName: !!body.name,
      hasSessionId: !!body.sessionId,
    });
    return c.json({ error: 'name and sessionId required' }, 400);
  }

  try {
    console.log('Inserting task:', { name: body.name, sessionId: body.sessionId });
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

    console.log('Task inserted successfully:', { id: result[0].id, status: result[0].status });
    return c.json(result[0], 201);
  } catch (error) {
    console.error('Failed to insert task:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// PATCH /tasks/:id - called by post-tool-agent.sh
app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  let body;

  try {
    body = await c.req.json();
  } catch (error) {
    console.error('Malformed JSON response', error);
    return c.json({ error: 'Bad request' }, 400);
  }

  if (!id) {
    console.error('Missing required id:', { hasId: !!body.id });
    return c.json({ error: 'id required' }, 400);
  }

  try {
    console.log('Updating task:', {
      name: body.name,
      status: body.status,
      description: body.description,
    });
    const result = await db.update(tasksTable).set(body).where(eq(tasksTable.id, id)).returning();

    if (!result.length) {
      console.error('Task not found:', id);
      return c.json({ error: 'no task found for that id' }, 404);
    }

    return c.json(result[0], 200);
  } catch (error) {
    console.error('Failed to insert task:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// DELETE /tasks/:id
app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  console.log('DELETE tasks/:id called with:', { id });

  if (!id) {
    console.error('Missing ID param');
    return c.json({ error: 'id required' }, 400);
  }

  try {
    const result = await db.delete(tasksTable).where(eq(tasksTable.id, id)).returning();

    if (!result.length) {
      console.error('Task not found to delete:', id);
      return c.json({ error: 'no task found to delete' }, 404);
    }
    console.log('Task deleted:', id);

    return c.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete task', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// -- SESSION EVENTS
// GET /sessionEvents
app.get('/sessionEvents', async (c) => {
  const sessionId = c.req.query('sessionId');
  console.log('GET /sessionEvents called with:', sessionId);

  // select rows based on param: sessionId or all if no param sent in req
  try {
    const rows = sessionId
      ? await db
          .select()
          .from(sessionEventsTable)
          .where(eq(sessionEventsTable.sessionId, sessionId))
      : await db.select().from(sessionEventsTable);
    console.log('Query returned:', {
      rows: rows.length,
      id: rows[0]?.id,
      sessionId: rows[0]?.id,
      type: rows[0]?.type,
      agentType: rows[0]?.agentType,
      model: rows[0]?.model,
    });

    // map over each event in rows and parse metadata field back into an object
    return c.json(
      rows.map((e) => ({
        ...e,
        metadata: e.metadata ? JSON.parse(e.metadata) : undefined,
      })),
    );
  } catch (error) {
    console.error('Query failed:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// POST /sessionEvents - called by session-event.sh
app.post('/sessionEvents', async (c) => {
  let body;

  try {
    body = await c.req.json();
  } catch (error) {
    console.error('Malformed JSON response', error);
    return c.json({ error: 'Bad request' }, 400);
  }

  if (!body.sessionId || !body.type) {
    console.error('Missing required fields:', {
      hasSessionId: !!body.sessionId,
      hasType: !!body.type,
    });
    return c.json({ error: 'sessionId and type required' }, 400);
  }

  try {
    console.log('Inserting sessionEvent:', {
      sessionId: body.sessionId,
      type: body.type,
      summary: body.summary,
    });
    const result = await db
      .insert(sessionEventsTable)
      .values({
        ...body,
        id: crypto.randomUUID(),
        metadata: body.metadata || null,
      })
      .returning();
    console.log('Inserted sessionEvent successfully:', {
      id: result[0]?.id,
      sessionId: result[0]?.sessionId,
      type: result[0]?.type,
      summary: result[0]?.summary,
      agentType: result[0]?.agentType,
    });

    return c.json(result[0], 201);
  } catch (error) {
    console.error('Failed to insert sessionEvent:', error);
    return c.json({ error: 'Database error' }, 500);
  }
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
