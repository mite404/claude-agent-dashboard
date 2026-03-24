import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';

const sqlite = new Database('./data/dashboard.db');

sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA synchronous = NORMAL');

export const db = drizzle({
  client: sqlite,
  casing: 'snake_case',
  schema,
});
