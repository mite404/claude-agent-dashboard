# SQLite + Drizzle Migration — Challenge-Based Tutorial

**Audience:** Bootcamp grad crossing from beginner → intermediate, Express background
**Goal:** Replace json-server with a custom SQLite database + Hono REST API
**Estimated Time:** 2–3 hours (hands-on)

---

## Table of Contents

1. [Mental Model: From Tape Machine to Recording Studio](#mental-model-from-tape-machine-to-recording-studio)
2. [Setup: Install New Dependencies](#setup-install-new-dependencies)
3. [Challenge 1: Drizzle Config](#challenge-1-drizzle-config)
4. [Challenge 2: Database Schema](#challenge-2-database-schema)
5. [Challenge 3: Database Client](#challenge-3-database-client)
6. [Challenge 4: REST API Server](#challenge-4-rest-api-server)
7. [Challenge 5: Data Migration Script](#challenge-5-data-migration-script)
8. [Challenge 6: Wire Everything Together](#challenge-6-wire-everything-together)
9. [Full Solutions](#full-solutions)
10. [Testing Checklist](#testing-checklist)
11. [Debugging Tips](#debugging-tips)
12. [Key Takeaways](#key-takeaways)

---

## Mental Model: From Tape Machine to Recording Studio

Think of your current stack like a **film archive room**:

- **`db.json`** is a VHS tape — all your data on one flat cassette
- **`json-server`** is a playback machine — it reads the tape and serves data automatically,
  but it's dumb (no transactions, no concurrent writes, no queries)
- **The hook scripts** are the camera operators — they write new footage to the tape, hoping
  nobody else is writing at the same time

The new stack is like upgrading to a **proper recording studio**:

- **SQLite (`dashboard.db`)** is the multi-track recorder — real ACID transactions, atomic
  writes, no race conditions
- **Drizzle ORM** is the mixing console — gives you a TypeScript interface to talk to SQLite
- **`src/server.ts` (Hono)** is the studio engineer — handles incoming requests and routes
  them to the right track
- **`drizzle.config.ts`** is the studio blueprint — tells the tooling where everything lives

### Two Config Files, Two Different Jobs

One thing that confuses people about Drizzle: there are **two separate files** and they serve
totally different purposes at totally different times.

| File | Used By | When | Purpose |
|------|---------|------|---------|
| `drizzle.config.ts` | `drizzle-kit` CLI | Build time | Generate migration SQL files |
| `src/db/index.ts` | `server.ts` | Runtime | Connect to the database |

Think of `drizzle-kit` as the **construction crew** that builds the studio (creates tables).
Your `server.ts` is the **studio staff** that operates it every day.

You run `drizzle-kit` once (or when the schema changes). The `db` client in `index.ts` runs
every time your server starts.

### How json-server Worked (and Why We're Replacing It)

json-server was auto-pilot. You pointed it at `db.json` and it magically created REST
endpoints. No code needed.

The problem: it's a **file writer**. When two hooks fire at the same moment, both try to
write to `db.json` at the same time. One overwrites the other. You lose data silently.

SQLite fixes this with **transactions** — a guarantee that two writes can't conflict. Drizzle
gives you the TypeScript API to write those transactions. But you have to write the routes
yourself. That's what `src/server.ts` is for.

---

## Setup: Install New Dependencies

First, install Hono (the Express-style HTTP framework for Bun):

```bash
bun add hono
```

Then create the directory for your database file and git-ignore it:

```bash
mkdir -p data
echo "data/dashboard.db" >> .gitignore
```

You already have `drizzle-orm`, `drizzle-kit`, and `better-sqlite3` in `package.json`.
Check that with:

```bash
bun pm ls | grep -E "drizzle|better-sqlite"
```

> **Why Hono and not Express?** Express was built for Node.js. Bun has its own HTTP runtime.
> Hono is designed for modern runtimes like Bun and has identical patterns to Express — same
> `app.get()`, `app.post()`, same mental model. The only difference is the handler signature,
> which you'll learn in Challenge 4.

---

## Challenge 1: Drizzle Config

**File:** `drizzle.config.ts` (project root, not inside `src/`)

**Concept:** This file tells `drizzle-kit` (the CLI migration tool) three things:

1. Where your schema file lives
2. What kind of database you're using
3. Where the actual `.db` file lives

You use this file when you run `bunx drizzle-kit push` — a command that reads your schema
and creates (or updates) tables in the database. Think of it as the architect's blueprint
that the construction crew uses to build the studio.

This file is **never imported by your server**. It's only for the CLI tool.

### Hint

- `out` is where Drizzle puts generated migration SQL files — use `'./drizzle'`
- `schema` is the path to your TypeScript schema file (relative to project root)
- `dialect` is the database engine type — `'sqlite'` for this project
- `url` under `dbCredentials` is the path to your `.db` file

### Starting Code

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: '___________',   // TODO: path to your schema file
  dialect: '___________',  // TODO: what type of database?
  dbCredentials: {
    url: '___________',    // TODO: path to your .db file
  },
})
```

**Questions to answer before looking at the solution:**

- Why does `drizzle.config.ts` live at the project root and not inside `src/`?
- What does `bunx drizzle-kit push` actually do when it reads this config?
- The Drizzle docs example uses a `.env` file for `DB_FILE_NAME`. Why don't we need that here?

---

## Challenge 2: Database Schema

**File:** `src/db/schema.ts`

**Concept:** This file defines your tables in TypeScript. Drizzle reads it and generates the
SQL `CREATE TABLE` statements. Think of it like declaring TypeScript interfaces, except these
interfaces also describe the actual database structure.

### SQLite Column Types

SQLite is simpler than PostgreSQL — it only has three core types:

| Drizzle Function | SQL Type | Use For |
|-----------------|---------|---------|
| `text('name')` | `TEXT` | strings, ISO date strings, and JSON |
| `integer('name')` | `INTEGER` | numbers, and booleans (stored as 0 or 1) |
| `real('name')` | `REAL` | floating point numbers |

Notice: no `Date` type, no `Array` type, no `Boolean` type. SQLite stores everything as one
of these three primitives.

### The JSON Columns Problem

Your `Task` type has `logs: LogEntry[]` and `events: HookEvent[]` — arrays of objects.
SQLite has no native array type.

**The solution:** store them as a **JSON string** (`text` column) and convert on the way in
and out:

- **Writing to DB:** `JSON.stringify(task.logs)` → stored as `"[{...}]"` text
- **Reading from DB:** `JSON.parse(row.logs)` → back to `[{...}]` array

You'll handle this conversion in Challenge 4 (the server). For the schema, just mark these
columns as `text`.

### Two Import Paths in Drizzle

Drizzle has separate packages for different databases. For **schema definition**, use:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
```

For **client initialization** (Challenge 3), you'll use a different path:

```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3'
```

Same package (`drizzle-orm`), different sub-paths. One provides the schema helpers, the other
provides the database connector.

### Hint

Column modifiers chain after the type:

```typescript
text('id').primaryKey()           // marks as primary key
text('name').notNull()            // required field (can't be null)
integer('progress').default(0)    // optional with fallback
text('logs').default('[]')        // JSON array default
text('parent_id')                 // nullable — no modifier needed
```

### Starting Code

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

// Sessions table: tracks orchestrator and agent sessions
export const sessionsTable = sqliteTable('sessions', {
  id:              text('id').___________,                  // TODO: primary key
  type:            text('type').___________,                // TODO: required, CHECK constraint
  parentSessionId: text('parent_session_id'),               // nullable: only agents have parents
  model:           text('model'),
  agentType:       text('agent_type'),
  status:          text('status').___________,              // TODO: required, CHECK constraint
  createdAt:       text('created_at'),
  stoppedAt:       text('stopped_at'),
})

// Tasks table: work units assigned to agents or orchestrator
export const tasksTable = sqliteTable('tasks', {
  id:                 text('id').___________,               // TODO: primary key
  sessionId:          text('session_id').___________,       // TODO: required, foreign key to sessions
  parentId:           text('parent_id'),                    // nullable: references tasks(id)
  name:               text('name').___________,             // TODO: required
  description:        text('description'),
  status:             text('status').___________,           // TODO: required, CHECK constraint
  kind:               text('kind'),                         // TODO: CHECK constraint
  priority:           text('priority'),                     // TODO: CHECK constraint
  createdBy:          text('created_by'),                   // 'orchestrator' or agent_id
  claimedBy:          text('claimed_by'),                   // agent_id that claimed this task
  progressPercentage: integer('progress_percentage').___________, // TODO: default 0
  createdAt:          text('created_at'),
  startedAt:          text('started_at'),
  claimedAt:          text('claimed_at'),
  completedAt:        text('completed_at'),
})

// Task dependencies: tracks which tasks block others
export const taskDependenciesTable = sqliteTable(
  'task_dependencies',
  {
    taskId:       text('task_id').___________,              // TODO: required, foreign key to tasks
    dependsOnId:  text('depends_on_id').___________,        // TODO: required, foreign key to tasks
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.dependsOnId] }), // TODO: composite primary key
  }),
)

// Logs table: task execution logs
export const logsTable = sqliteTable('logs', {
  id:        text('id').___________,                        // TODO: primary key
  taskId:    text('task_id').___________,                   // TODO: required, foreign key to tasks
  timestamp: text('timestamp'),
  level:     text('level').___________,                     // TODO: default 'info'
  message:   text('message'),
})

// Session events table: tracks all session lifecycle events
export const sessionEventsTable = sqliteTable('session_events', {
  id:        text('id').___________,                        // TODO: primary key
  sessionId: text('session_id').___________,                // TODO: required, foreign key to sessions
  type:      text('type').___________,                      // TODO: required
  summary:   text('summary'),
  timestamp: text('timestamp'),
  agentId:   text('agent_id'),
  agentType: text('agent_type'),
  model:     text('model'),
  data:      text('data'),                                  // JSON blob: event-specific fields
})

// Schema version table: tracks which migrations have been applied
export const schemaVersionTable = sqliteTable('schema_version', {
  version:   integer('version').___________,                // TODO: primary key
  appliedAt: text('applied_at').___________,                // TODO: required, unique
})
```

**Key differences from a simplified tutorial schema:**

- **Session hierarchy**: `parentSessionId` creates a tree (orchestrator → agents)
- **Separate tables for logs**: Not JSON in tasks; proper relational design
- **Proper constraints**: `kind`, `priority`, `status` have CHECK constraints
- **Task claiming**: `createdBy` and `claimedBy` track who created and claimed tasks
- **Schema versioning**: Tracks which migrations have run

**Questions to answer before looking at the solution:**

- Why does `tasksTable` need a foreign key to `sessionsTable`?
- What's the purpose of the composite primary key in `taskDependenciesTable`?
- Why are `logs` in a separate table instead of stored as JSON in `tasksTable`?

---

## Challenge 3: Database Client

**File:** `src/db/index.ts`

**Concept:** This file creates the runtime connection between your code and the `.db` file on
disk. Two layers are involved:

1. **`better-sqlite3`** opens the raw file at the OS level (the cable)
2. **`drizzle()`** wraps it with the TypeScript query API (the mixing board)

You run this once at server startup. The exported `db` object is what `server.ts` uses to
query the database.

### What WAL Mode Is

**WAL** stands for Write-Ahead Logging. It's a database setting that changes how SQLite
handles multiple readers and writers.

Without WAL: if one process is writing, all readers are blocked until the write finishes.
With WAL: readers and writers can work at the same time without blocking each other.

For this project, multiple hook scripts can fire simultaneously — one finishing a task while
another is starting a new one. WAL mode prevents them from blocking each other.

### Hint

```
better-sqlite3  →  new Database('./data/dashboard.db')
                    sqlite.pragma('journal_mode = WAL')
                    sqlite.pragma('synchronous = NORMAL')
drizzle-orm     →  drizzle(sqlite)
```

The pragma calls are configuration commands sent directly to SQLite. `synchronous = NORMAL`
is safe for this use case and faster than the default `FULL` mode.

### Starting Code

```typescript
// src/db/index.ts
import Database from '___________'       // TODO: the better-sqlite3 package name
import { drizzle } from '___________'   // TODO: the drizzle adapter for better-sqlite3

// Open (or create) the SQLite file on disk
const sqlite = new Database('___________')  // TODO: path to .db file

// Configure SQLite for concurrent access
sqlite.pragma('___________')              // TODO: set journal_mode to WAL
sqlite.pragma('synchronous = NORMAL')

// Wrap with Drizzle to get the TypeScript query API
export const db = drizzle(___________)   // TODO: pass the sqlite connection
```

**Questions to answer before looking at the solution:**

- The import is `drizzle-orm/better-sqlite3` — not `drizzle-orm/libsql`. Why does the
  sub-path matter?
- Why do we export `db` but not `sqlite`?
- This file creates one connection that lives for the lifetime of the server process. What
  would happen if you created a new connection inside every route handler instead?

---

## Challenge 4: REST API Server

**File:** `src/server.ts`

**Concept:** This file replaces `json-server`. Instead of auto-pilot reading `db.json`, you
write the routes yourself — with full control over what each endpoint does.

### Hono vs Express — The Only Differences You Need to Know

Hono is intentionally Express-like. If you know Express, you already know 95% of Hono.

| Express | Hono | Notes |
|---------|------|-------|
| `(req, res) =>` | `(c) =>` | Single context object instead of two params |
| `req.params.id` | `c.req.param('id')` | Route parameters |
| `req.query.status` | `c.req.query('status')` | Query string |
| `await req.json()` | `await c.req.json()` | Request body |
| `res.json(data)` | `return c.json(data)` | Must `return` in Hono |
| `res.status(404).json({})` | `return c.json({}, 404)` | Status as second arg |

Everything else is identical: `app.get()`, `app.post()`, `app.patch()`, `app.delete()`.

### The Bun Startup Pattern

In Express, you end your server file with `app.listen(3001)`. In Bun, you export the server
as the default export:

```typescript
export default {
  port: 3001,
  fetch: app.fetch,
}
```

Bun reads this and starts the server. The `fetch` property is Hono's internal request
handler — you don't need to understand its internals, just know that this is the wiring.

### The One JSON Field You Actually Have

Look back at your schema. Tasks use proper relational tables (`logsTable`,
`taskDependenciesTable`) — no JSON columns on `tasksTable`. Tasks routes are clean: just
insert and return the fields the schema defines.

The **only** JSON field is `sessionEventsTable.data` — a catch-all blob for event-specific
metadata. That one field needs serialize/parse treatment:

- **stringify before writing:** `data: body.data ? JSON.stringify(body.data) : null`
- **parse after reading:** `data: e.data ? JSON.parse(e.data) : undefined`

Everything else (`tasksTable`, `sessionsTable`) is plain text/integer columns — no
conversion needed.

### Drizzle Query Patterns

Drizzle reads like SQL. Each method maps directly:

| What you want | Drizzle |
|--------------|---------|
| `SELECT * FROM tasks` | `db.select().from(tasksTable)` |
| `SELECT * WHERE id = x` | `.where(eq(tasksTable.id, id))` |
| Multiple WHERE conditions | `.where(and(eq(...), eq(...)))` |
| `INSERT INTO ... RETURNING *` | `db.insert(tasksTable).values(body).returning()` |
| `UPDATE ... SET ... RETURNING *` | `db.update(tasksTable).set(body).where(...).returning()` |
| `DELETE FROM ... WHERE` | `db.delete(tasksTable).where(...)` |

`eq` and `and` come from `drizzle-orm`. The `.returning()` at the end of insert/update is
important — without it, Drizzle doesn't return the saved record, just the count of changes.

### Starting Code

```typescript
// src/server.ts
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from './db/index'
import { tasksTable, sessionEventsTable } from './db/schema'

const app = new Hono()

// ─── TASKS ───────────────────────────────────────────────────────────────────

// GET /tasks  — list all, optionally filtered by ?status= or ?sessionId=
app.get('/tasks', async (c) => {
  const status    = c.req.query('___________')  // TODO: query param name
  const sessionId = c.req.query('___________')  // TODO: query param name

  // TODO: build conditions array and query
  // If both params are empty, return all tasks
  // If one or both params exist, add eq() conditions and use and()

  const rows = [] // TODO: replace with real query
  return c.json(rows)
})

// GET /tasks/:id
app.get('/tasks/:id', async (c) => {
  const id = c.req.param('id')
  // TODO: select from tasksTable where id matches
  // TODO: if rows is empty, return c.json({ error: 'Not found' }, 404)
  // TODO: return rows[0]
  return c.json({})
})

// POST /tasks — called by pre-tool-agent.sh
app.post('/tasks', async (c) => {
  const body = await c.req.json()
  // TODO: db.insert(tasksTable).values({ id, name, sessionId, status, createdAt }).returning()
  // TODO: return result[0] with status 201
  return c.json({}, 201)
})

// PATCH /tasks/:id — called by post-tool-agent.sh
app.patch('/tasks/:id', async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  // TODO: db.update(tasksTable).set(body).where(eq(...)).returning()
  // TODO: if result is empty, return 404
  return c.json({})
})

// DELETE /tasks/:id
app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id')
  // TODO: db.delete(tasksTable).where(eq(...))
  return c.json({ ok: true })
})

// ─── SESSION EVENTS ───────────────────────────────────────────────────────────

// GET /sessionEvents
app.get('/sessionEvents', async (c) => {
  // TODO: select all from sessionEventsTable
  // TODO: map rows — parse the `data` JSON field back to an object
  return c.json([])
})

// POST /sessionEvents — called by session-event.sh
app.post('/sessionEvents', async (c) => {
  const body = await c.req.json()
  // TODO: insert — stringify body.data before storing (it's the only JSON field)
  // TODO: return result[0] with status 201
  return c.json({}, 201)
})

// ─── Bun runtime adapter ──────────────────────────────────────────────────────
// This replaces app.listen(3001) from Express
export default {
  port: 3001,
  fetch: app.fetch,
}
```

**Questions to answer before looking at the solution:**

- Tasks have no JSON columns — so why does `sessionEventsTable` need serialize/parse
  treatment but `tasksTable` does not?
- The POST route returns status `201` but the PATCH route returns `200` (default). What
  does the HTTP status code communicate to the caller?
- Why does `.returning()` matter on an insert? What happens without it?
- The Vite proxy rewrites `/api/tasks` → `http://localhost:3001/tasks`. So should the
  hook scripts call `/api/tasks` or `/tasks`? (Think about where hooks run.)

---

## Challenge 5: Data Migration Script

**File:** `scripts/migrate-to-sqlite.ts`

**Concept:** A one-time script that reads `db.json` and inserts everything into SQLite.
After you run it, `db.json` becomes a backup — the `.db` file is the new source of truth.

This is a **script**, not part of the server. You run it once with `bun scripts/migrate-to-sqlite.ts`.
You don't import it anywhere.

### The Mismatch Problem

Your `db.json` tasks have fields like `agentType` (camelCase). Your schema columns are
`agent_type` (snake_case). Drizzle's TypeScript API uses camelCase — so when inserting,
you use `agentType` and Drizzle handles the translation.

Some fields in `db.json` might also be `null` or missing entirely. Use `?? null` or
`?? defaultValue` to handle those safely.

### Hint

- Read the file: `const data = await Bun.file('./db.json').json()`
- Loop with `for...of` (async-safe, unlike `.forEach`)
- Stringify JSON fields: `JSON.stringify(task.logs ?? [])`
- For session events: capture any extra fields with object destructuring into `...rest`,
  then store `rest` as the `data` JSON column

### Starting Code

```typescript
// scripts/migrate-to-sqlite.ts
import { db } from '../src/db/index'
import { tasksTable, sessionEventsTable } from '../src/db/schema'

async function migrate() {
  const data = await Bun.file('./db.json').json()

  console.log(`Migrating ${data.tasks.length} tasks...`)

  for (const task of data.tasks) {
    await db.insert(tasksTable).values({
      id:       task.id,
      name:     task.name,
      status:   task.status,
      agentType: task.agentType ?? 'unknown',
      // TODO: fill in remaining fields from the schema
      // TODO: stringify logs, events, dependencies with JSON.stringify(task.x ?? [])
      // TODO: handle nullable fields with ?? null
    })
  }

  console.log(`Migrating ${data.sessionEvents.length} session events...`)

  for (const event of data.sessionEvents) {
    // TODO: destructure the known fields, capture the rest
    // Hint: const { id, type, timestamp, sessionId, summary, agentId, agentType, model, ...rest }
    //       = event
    // TODO: insert with data: JSON.stringify(rest) for the extra fields
  }

  console.log('✅ Migration complete!')
}

migrate().catch(console.error)
```

**Questions to answer before looking at the solution:**

- Why use a separate script for migration instead of running it automatically when the
  server starts?
- What happens if you run this script twice? How would you prevent duplicate key errors?
- Some tasks in `db.json` have `originatingSkill: null`. Does your schema handle that?

---

## Challenge 6: Wire Everything Together

**Files:** `package.json`

**Concept:** Remove `json-server` from the dev script and start `src/server.ts` instead.
Vite's proxy already points at port 3001 — you're just changing what's running there.

The Vite proxy config in `vite.config.ts` doesn't need to change. It already says "forward
`/api/*` to `localhost:3001`" — and your new server is on port 3001 just like the old one.

### Hint

To run a Bun file: `bun src/server.ts`

The current dev script starts 4 processes with `concurrently`. You're replacing the
`json-server ...` process with `bun src/server.ts`. The other three stay the same.

Also update the standalone `"server"` script — it currently runs json-server directly and
is useful for isolated API testing without the full dev environment.

### Starting Code

```json
{
  "scripts": {
    "dev": "concurrently --names \"vite,api,hooks,spawn\" \"vite --port 5173\" \"___________\" \"tail -F logs/hooks.log\" \"bun scripts/spawn-terminal.ts\"",
    "server": "___________"
  }
}
```

**Order of operations before `bun run dev`:**

```bash
# Step 1: Create tables in the database (one time)
bunx drizzle-kit push

# Step 2: Migrate existing data from db.json (one time)
bun scripts/migrate-to-sqlite.ts

# Step 3: Start everything
bun run dev
```

**Questions to answer before looking at the solution:**

- What command runs a TypeScript file with Bun?
- Why does `bunx drizzle-kit push` need to happen before the server starts the first time?
- How can you verify the new server is actually running on port 3001?

---

## Full Solutions

### ✓ Challenge 1: drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/dashboard.db',
  },
})
```

**Key points:**

- Lives at the project root because `drizzle-kit` is a dev CLI tool, not part of `src/`
- `bunx drizzle-kit push` reads this, compares your schema to what's in the `.db` file,
  and runs `CREATE TABLE` or `ALTER TABLE` as needed
- No `.env` file needed because `./data/dashboard.db` is a local path, not a secret.
  The Drizzle docs use `.env` because `libsql` often connects to remote Turso servers

---

### ✓ Challenge 2: Database Schema

```typescript
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

// Sessions table
export const sessionsTable = sqliteTable('sessions', {
  id:              text('id').primaryKey(),
  type:            text('type').notNull(),
  parentSessionId: text('parent_session_id').references((): any => sessionsTable.id),
  model:           text('model'),
  agentType:       text('agent_type'),
  status:          text('status').notNull(),
  createdAt:       text('created_at'),
  stoppedAt:       text('stopped_at'),
})

// Tasks table
export const tasksTable = sqliteTable('tasks', {
  id:                 text('id').primaryKey(),
  sessionId:          text('session_id').notNull()
    .references((): any => sessionsTable.id),
  parentId:           text('parent_id').references((): any => tasksTable.id),
  name:               text('name').notNull(),
  description:        text('description'),
  status:             text('status').notNull(),
  kind:               text('kind'),
  priority:           text('priority'),
  createdBy:          text('created_by'),
  claimedBy:          text('claimed_by'),
  progressPercentage: integer('progress_percentage').default(0),
  createdAt:          text('created_at'),
  startedAt:          text('started_at'),
  claimedAt:          text('claimed_at'),
  completedAt:        text('completed_at'),
})

// Task dependencies
export const taskDependenciesTable = sqliteTable(
  'task_dependencies',
  {
    taskId:       text('task_id').notNull()
      .references((): any => tasksTable.id),
    dependsOnId:  text('depends_on_id').notNull()
      .references((): any => tasksTable.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.dependsOnId] }),
  }),
)

// Logs table
export const logsTable = sqliteTable('logs', {
  id:        text('id').primaryKey(),
  taskId:    text('task_id').notNull()
    .references((): any => tasksTable.id),
  timestamp: text('timestamp'),
  level:     text('level').default('info'),
  message:   text('message'),
})

// Session events table
export const sessionEventsTable = sqliteTable('session_events', {
  id:        text('id').primaryKey(),
  sessionId: text('session_id').notNull()
    .references((): any => sessionsTable.id),
  type:      text('type').notNull(),
  summary:   text('summary'),
  timestamp: text('timestamp'),
  agentId:   text('agent_id'),
  agentType: text('agent_type'),
  model:     text('model'),
  data:      text('data'),
})

// Schema version
export const schemaVersionTable = sqliteTable('schema_version', {
  version:   integer('version').primaryKey(),
  appliedAt: text('applied_at').notNull().unique(),
})
```

**Key points:**

- **Session hierarchy**: `parentSessionId` references `sessions(id)` to create parent-child relationships
  between orchestrator and agent sessions
- **Task hierarchy**: `parentId` references `tasks(id)` for subtask nesting
- **Foreign keys**: `sessionId` in tasks, `taskId` in logs — these ensure referential integrity
- **Composite primary key**: `taskDependenciesTable` uses both `taskId` and `dependsOnId` as the PK
  so you can't have duplicate task-dependency pairs
- **Logs as a separate table**: Not embedded JSON — this lets you query logs independently, filter by
  level, count by status, etc.
- **Proper schema versioning**: Tracks which migrations have been applied (Challenge 5)

---

### ✓ Challenge 3: Database Client

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const sqlite = new Database('./data/dashboard.db')

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('synchronous = NORMAL')

export const db = drizzle(sqlite)
```

**Key points:**

- Import path is `drizzle-orm/better-sqlite3` — Drizzle has different adapters for
  different drivers (`libsql`, `better-sqlite3`, `bun:sqlite`). Using the wrong one causes
  subtle type errors
- We export `db`, not `sqlite` — `server.ts` uses Drizzle's TypeScript API and never needs
  to touch the raw SQLite connection directly
- One connection per process is correct. Creating a new connection per route handler would
  create hundreds of open file handles and cause errors

---

### ✓ Challenge 4: REST API Server

```typescript
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from './db/index'
import { tasksTable, sessionEventsTable } from './db/schema'

const app = new Hono()

// ─── TASKS ────────────────────────────────────────────────────────────────────
// tasksTable has no JSON columns — plain insert/select/update/delete

app.get('/tasks', async (c) => {
  const status    = c.req.query('status')
  const sessionId = c.req.query('sessionId')

  const conditions = []
  if (status)    conditions.push(eq(tasksTable.status, status))
  if (sessionId) conditions.push(eq(tasksTable.sessionId, sessionId))

  const rows = conditions.length > 0
    ? await db.select().from(tasksTable).where(and(...conditions))
    : await db.select().from(tasksTable)

  return c.json(rows)
})

app.get('/tasks/:id', async (c) => {
  const id   = c.req.param('id')
  const rows = await db.select().from(tasksTable).where(eq(tasksTable.id, id))
  if (!rows.length) return c.json({ error: 'Not found' }, 404)
  return c.json(rows[0])
})

app.post('/tasks', async (c) => {
  const body   = await c.req.json()
  const result = await db.insert(tasksTable).values({
    id:        crypto.randomUUID(),
    name:      body.name,
    sessionId: body.sessionId,
    status:    body.status ?? 'unassigned',
    createdAt: new Date().toISOString(),
  }).returning()
  return c.json(result[0], 201)
})

app.patch('/tasks/:id', async (c) => {
  const id     = c.req.param('id')
  const body   = await c.req.json()
  const result = await db
    .update(tasksTable)
    .set(body)
    .where(eq(tasksTable.id, id))
    .returning()
  if (!result.length) return c.json({ error: 'Not found' }, 404)
  return c.json(result[0])
})

app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(tasksTable).where(eq(tasksTable.id, id))
  return c.json({ ok: true })
})

// ─── SESSION EVENTS ───────────────────────────────────────────────────────────
// sessionEventsTable.data IS a JSON blob — the only field that needs serialize/parse

app.get('/sessionEvents', async (c) => {
  const rows = await db.select().from(sessionEventsTable)
  return c.json(rows.map(e => ({
    ...e,
    data: e.data ? JSON.parse(e.data) : undefined,
  })))
})

app.post('/sessionEvents', async (c) => {
  const body   = await c.req.json()
  const result = await db.insert(sessionEventsTable).values({
    ...body,
    data: body.data ? JSON.stringify(body.data) : null,
  }).returning()
  return c.json(result[0], 201)
})

// ─── Bun runtime adapter ──────────────────────────────────────────────────────
export default {
  port: 3001,
  fetch: app.fetch,
}
```

**Key points:**

- `tasksTable` has no JSON columns — logs live in `logsTable`, dependencies in
  `taskDependenciesTable`. Tasks routes are clean Drizzle CRUD with no conversion logic.
- `sessionEventsTable.data` is the only JSON field in the whole schema. You serialize
  on write and parse on read for that one field only.
- `201 Created` vs `200 OK`: `201` tells the caller that a new resource was created (not
  just that the request succeeded). Your hook scripts don't check this, but good APIs
  communicate intent through status codes.
- `.returning()` is essential after `insert` and `update` — without it, Drizzle returns
  metadata (rows affected) not the actual saved record.
- The Vite proxy strips `/api` before forwarding. Hook scripts call the server directly
  (no Vite proxy), so they use `http://localhost:3001/tasks` without `/api`.

---

### ✓ Challenge 5: Data Migration Script

```typescript
import { db } from '../src/db/index'
import { tasksTable, sessionEventsTable } from '../src/db/schema'

async function migrate() {
  const data = await Bun.file('./db.json').json()

  console.log(`Migrating ${data.tasks.length} tasks...`)

  for (const task of data.tasks) {
    await db.insert(tasksTable).values({
      id:                   task.id,
      name:                 task.name,
      status:               task.status,
      agentType:            task.agentType            ?? 'unknown',
      parentId:             task.parentId             ?? null,
      sessionId:            task.sessionId            ?? null,
      createdAt:            task.createdAt,
      startedAt:            task.startedAt            ?? null,
      completedAt:          task.completedAt          ?? null,
      progressPercentage:   task.progressPercentage   ?? 0,
      agentId:              task.agentId              ?? null,
      lastAssistantMessage: task.lastAssistantMessage ?? null,
      originatingSkill:     task.originatingSkill     ?? null,
      taskKind:             task.taskKind             ?? 'work',
      logs:                 JSON.stringify(task.logs         ?? []),
      events:               JSON.stringify(task.events       ?? []),
      dependencies:         JSON.stringify(task.dependencies ?? []),
    })
  }

  console.log(`Migrating ${data.sessionEvents.length} session events...`)

  for (const event of data.sessionEvents) {
    const {
      id, type, timestamp, sessionId,
      summary, agentId, agentType, model,
      ...rest
    } = event

    await db.insert(sessionEventsTable).values({
      id, type, timestamp, sessionId,
      summary:   summary   ?? null,
      agentId:   agentId   ?? null,
      agentType: agentType ?? null,
      model:     model     ?? null,
      data: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
    })
  }

  console.log('✅ Migration complete!')
}

migrate().catch(console.error)
```

**Key points:**

- Run as a standalone script, not at server startup — migration is a one-time operation,
  not something every server start should attempt
- Running it twice will fail with a UNIQUE constraint error (duplicate primary keys). You
  can make it idempotent with `.onConflictDoNothing()` after `.values()`, but for a
  one-time script that's usually overkill
- The `...rest` spread captures any fields in `db.json` that don't have their own columns
  (e.g., `tokenCount`, `reason`, `filePath`). They all land in the `data` JSON blob

---

### ✓ Challenge 6: package.json

```json
{
  "scripts": {
    "dev": "concurrently --names \"vite,api,hooks,spawn\" \"vite --port 5173\" \"bun src/server.ts\" \"tail -F logs/hooks.log\" \"bun scripts/spawn-terminal.ts\"",
    "server": "bun src/server.ts"
  }
}
```

**Key points:**

- `bun src/server.ts` starts the Hono server on port 3001
- `vite.config.ts` doesn't change — it still proxies `/api/*` → `localhost:3001`
- To verify the server: `curl http://localhost:3001/tasks` while it's running

---

## Testing Checklist

Run these in order before calling the migration complete:

- [ ] `mkdir -p data` and `echo "data/dashboard.db" >> .gitignore`
- [ ] `bun add hono` installed successfully
- [ ] `bunx drizzle-kit push` — no errors, prints table names
- [ ] `ls data/` — `dashboard.db` exists
- [ ] `bun scripts/migrate-to-sqlite.ts` — shows task and event counts, no errors
- [ ] `bun src/server.ts` — prints nothing (or "listening on port 3001")
- [ ] `curl http://localhost:3001/tasks` — returns a JSON array of tasks
- [ ] `curl http://localhost:3001/tasks/SOME_ID` — returns a single task with array `logs`
- [ ] `curl http://localhost:3001/sessionEvents` — returns events array
- [ ] Trigger a hook — new task appears in `curl` output without restarting server
- [ ] `bun run dev` — all 4 processes start, dashboard loads at `localhost:5173`
- [ ] Dashboard renders tasks correctly with no console errors

---

## Debugging Tips

**`bunx drizzle-kit push` fails with "file not found":**

- Make sure `data/` directory exists (`mkdir -p data`)
- Verify `drizzle.config.ts` is in the project root, not inside `src/`
- Check the `url` path matches exactly: `'./data/dashboard.db'`

**Migration script crashes with "no such table":**

- You must run `bunx drizzle-kit push` before the migration script
- Tables must exist before you can insert into them

**`curl /tasks` returns tasks with `logs: "[{...}]"` as a string:**

- `parseTasks()` isn't being called before `c.json()`
- Check that GET `/tasks` calls `c.json(parseTasks(rows))` not `c.json(rows)`

**Hook fires but task doesn't appear in dashboard:**

- Hooks call `http://localhost:3001/tasks` directly (not through Vite proxy)
- Check `scripts/pre-tool-agent.sh` — verify the POST URL doesn't have `/api/` prefix
- Check `logs/hooks.log` for curl error output

**Server starts but all routes return 404:**

- Hono routes must not have `/api` prefix (the proxy strips it before forwarding)
- Your route is `app.get('/tasks', ...)` not `app.get('/api/tasks', ...)`

**`bun run dev` starts but dashboard shows no tasks:**

- Confirm the migration script ran successfully
- Open Network tab in browser DevTools — check `/api/tasks` response
- Make sure `bun src/server.ts` is the process running on port 3001, not the old json-server

**TypeScript error on `drizzle(sqlite)`:**

- Confirm import is `from 'drizzle-orm/better-sqlite3'` not `'drizzle-orm/libsql'`
- These adapters have different function signatures — using the wrong one causes type errors

---

## Key Takeaways

1. **Two config files, two purposes:** `drizzle.config.ts` is a build-time CLI tool config.
   `src/db/index.ts` is the runtime database connection. They serve different masters.

2. **SQLite stores JSON as text:** Always `JSON.stringify()` on write, `JSON.parse()` on
   read. Helpers like `parseTasks()` and `serializeTask()` keep this in one place.

3. **Hono is Express on Bun:** Same `app.get()` / `app.post()` patterns. The only real
   differences are `c` instead of `(req, res)` and `export default { port, fetch }` instead
   of `app.listen()`.

4. **WAL mode matters:** Multiple hooks writing simultaneously won't block each other or
   corrupt the database. One pragma call gives you this for free.

5. **Drizzle is type-safe SQL:** `.select().from().where(eq())` is just `SELECT * FROM WHERE`
   in TypeScript. If you can read SQL, you can read Drizzle.

6. **Migration is a one-time script:** Not server startup logic. Run it once, then discard
   (or keep as a reference). The `.db` file is now the source of truth.

🎬 You just built your first custom database-backed REST API.
