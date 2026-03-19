import { sqliteTable, text, integer, SQLiteInteger, SQLiteTable } from 'drizzle-orm/sqlite-core';

export const sessionsTable: SQLiteTable = sqliteTable('sessions', {
  id: text().primaryKey(),
});

export const tasksTable: SQLiteTable = sqliteTable('tasks', {});

export const taskDependenciesTable: SQLiteTable = sqliteTable('task_dependencies', {});

export const logsTable: SQLiteTable = sqliteTable('logs', {});

export const sessionEventsTable: SQLiteTable = sqliteTable('session_events', {
  id: text().primaryKey(),
  sessionId: text()
    .notNull()
    .references(() => sessionsTable.id),
  type: text().notNull(),
  summary: text(),
  timestamp: text(),
  agentId: text(),
  agentType: text(),
  metadata: JSON,
});

export const schemaVersion: SQLiteTable = sqliteTable('schema_version', {
  version: integer().notNull(),
  applied_at: text('applied_at').notNull().unique(),
});
