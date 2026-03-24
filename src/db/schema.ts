import { sqliteTable, text, integer, primaryKey, json } from 'drizzle-orm/sqlite-core';

export const sessionsTable = sqliteTable('sessions', {
  id: text().primaryKey(),
  type: text().notNull(),
  parentSessionId: text().references((): any => sessionsTable.id),
  model: text(),
  agentType: text(),
  status: text().notNull(),
  createdAt: text(),
  stoppedAt: text(),
});

export const tasksTable = sqliteTable('tasks', {
  id: text().primaryKey(),
  sessionId: text()
    .notNull()
    .references(() => sessionsTable.id),
  parentId: text().references((): any => tasksTable.id),
  name: text().notNull(),
  description: text(),
  status: text().notNull().default('unassigned'),
  kind: text().default('work'),
  priority: text().default('normal'),
  createdBy: text(),
  claimedBy: text(),
  progressPercentage: integer().default(0),
  createdAt: text(),
  startedAt: text(),
  claimedAt: text(),
  completedAt: text(),
});

export const taskDependenciesTable = sqliteTable(
  'task_dependencies',
  {
    taskId: text()
      .notNull()
      .references(() => tasksTable.id),
    dependsOnId: text()
      .notNull()
      .references(() => tasksTable.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.dependsOnId] }),
  }),
);

export const logsTable = sqliteTable('logs', {
  id: text().primaryKey(),
  taskId: text()
    .notNull()
    .references(() => tasksTable.id),
  timestamp: text(),
  level: text().notNull().default('info'),
  message: text(),
});

export const sessionEventsTable = sqliteTable('session_events', {
  id: text().primaryKey(),
  sessionId: text()
    .notNull()
    .references(() => sessionsTable.id),
  type: text().notNull(),
  summary: text(),
  timestamp: text(),
  agentId: text().unique(),
  agentType: text().unique(),
  model: text(),
  metadata: json().default(null),
});

export const schemaVersion = sqliteTable('schema_version', {
  version: integer().primaryKey(),
  appliedAt: text().notNull().unique(),
});
