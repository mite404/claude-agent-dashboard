import { db } from '../src/db/index';
import { sessionsTable, tasksTable, sessionEventsTable } from '../src/db/schema';
import type { Task } from '../src/types/task';

async function migrate() {
  const data = await Bun.file('./db.json').json();

  const existingTasks = await db.select().from(tasksTable).limit(1);

  if (existingTasks.length > 0) {
    console.log('Tasks already migrated, skipping');
    return;
  }

  const existingSessionEvents = await db.select().from(sessionEventsTable).limit(1);

  if (existingSessionEvents.length > 0) {
    console.log('sessionEvents already migrated, skipping');
    return;
  }

  // 1. Extract unique sessionIds from ALL tasks
  const sessionIds = new Set(data.tasks.map((t: Task) => t.sessionId));

  // 2. Create all sessions ONCE
  for (const sessionId of sessionIds) {
    await db.insert(sessionsTable).values({
      id: String(sessionId),
      type: 'generated',
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
  }

  console.log(`Migrating ${data.tasks.length} tasks...`);

  for (const task of data.tasks) {
    await db.insert(tasksTable).values({
      id: task.id,
      sessionId: task.sessionId,
      parentId: task.parentId ?? null,
      name: task.name,
      description: task.description ?? null,
      status: task.status,
      kind: task.kind ?? 'work',
      priority: task.priority ?? 'normal',
      createdBy: task.createdBy ?? null,
      claimedBy: task.claimedBy ?? null,
      progressPercentage: task.progressPercentage ?? 0,
      createdAt: task.createdAt ?? null,
      startedAt: task.startedAt ?? null,
      claimedAt: task.claimedAt ?? null,
      completedAt: task.completedAt ?? null,
    });
  }

  console.log(`Migrating ${data.sessionEvents.length} session events...`);

  for (const event of data.sessionEvents) {
    const {
      id,
      sessionId,
      type,
      summary,
      timestamp,
      agentId,
      agentType,
      model, // ← schema columns
      ...rest // ← everything else in the SessionEvent type (tokenCount, toolName, error, etc.)
    } = event;

    await db.insert(sessionEventsTable).values({
      id,
      sessionId: sessionId ?? null,
      type,
      summary: summary ?? null,
      timestamp: timestamp ?? null,
      agentId: agentId ?? null,
      agentType: agentType ?? null,
      model: model ?? null,
      metadata: JSON.stringify(rest),
    }).onConflictDoNothing();
  }
}

migrate().catch(console.error);
