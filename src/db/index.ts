import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';

const sqlite = new Database('local.db');
const db = drizzle({ client: sqlite, casing: 'snake_case' });

export { db };
