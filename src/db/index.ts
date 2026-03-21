import { drizzle } from 'drizzle-orm/bun-sqlite';
import Database from 'better-sqlite3';
import * as schema from './schema';

const sqlite = new Database('./data/dashboard.db');

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle({
  client: sqlite,
  casing: 'snake_case',
  schema,
});
