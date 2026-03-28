# Hooks to SQLite Migration: Major Milestones

This document summarizes the key steps taken to reconnect hook scripts (event tracking) with the newly migrated SQLite/Hono backend after Phase 13 migration from json-server.

## Context: The Migration

**Before:** Hook scripts → json-server REST API → `db.json` flat file
**After:** Hook scripts → Hono web framework → SQLite database (with Drizzle ORM)

The backend changed, but the hook scripts still spoke the old "language" (json-server response shapes, old column names). The frontend expected data in old shapes. This created a cascading series of mismatches.

---

## The HTTP 500 Problem

**Symptom:** Frontend showed "Connection error: HTTP 500"

**Root cause:** The SQLite database in the conductor workspace had never been initialized. The schema migration ran in the original project directory (`/Users/ea/Programming/web/fractal/claude-agent-dashboard`), but not in the conductor workspace (`/Users/ea/conductor/workspaces/claude-agent-dashboard/troy`). When the server queried a 4KB empty database, every `SELECT * FROM tasks` threw `SQLiteError: no such table: tasks` → 500.

**Fix (Step 0):**

```bash
bunx drizzle-kit push              # Create all tables from schema
bun scripts/migrate-to-sqlite.ts   # Seed historical data (4 tasks, 571 events)
```

After Step 0: `GET /tasks` returned 200 with empty array (schema now exists).

---

## The Black Screen Problem

**Symptom:** Page loaded, then flashed to black and stayed black (no content rendered).

**Root cause:** Frontend component `TaskTable.tsx` assumed `task.logs` would be an array. But the SQLite migration moved logs to a separate `logsTable`, leaving `task.logs` undefined. When the component tried `task.logs.length`, it crashed: `Cannot read properties of undefined (reading 'length')`.

**Fix:** Added optional chaining to safely handle undefined logs:

- Line 703: `task.logs?.length ?? 0` (was `task.logs.length`)
- Line 1504: `(task.logs?.length ?? 0) > 0` (was `task.logs.length > 0`)

After this fix: Page loads without crashing; log detail panel shows empty (logs aren't eager-loaded yet).

---

## Response Shape Mismatches

**Problem:** Server returned responses wrapped in objects; frontend expected raw arrays/objects.

**Examples:**

- `GET /tasks` returned `{ data: rows }` but frontend did `Array.isArray(rawTasks)` → false
- `GET /tasks/:id` returned `{ task: {...} }` but shell scripts did `jq '.id'` → null

**Fixes (Step 2):**

- Changed `c.json({ data: rows })` → `c.json(rows)` (line 48 in server.ts)
- Changed `c.json({ task })` → `c.json(task)` (line 78 in server.ts)

After Step 2: `useTaskPolling` successfully parsed tasks; shell scripts could unwrap responses.

---

## Task ID Loss in POST /tasks

**Problem:** When hooks created a task, they sent `id: tool_use_id` (the stable identifier linking pre-hook → post-hook). The server discarded it and generated a new UUID.

**Impact:** Post-hook couldn't find the task to update because pre-hook and post-hook used different IDs. Status updates vanished.

**Fix (Step 3a):**

```typescript
// Before
id: crypto.randomUUID(),
// After
id: body.id || crypto.randomUUID(),
```

After this fix: Hook chain maintained task identity across pre/post events.

---

## Unknown Columns in PATCH /tasks/:id

**Problem:** Hook scripts sent payloads with `logs[]`, `events[]`, `dependencies[]` (json-server fields). The new server tried to `db.update(tasksTable).set(body)` with these non-existent columns → `SQLiteError`.

**Fix (Step 4a):** Whitelist valid columns and filter:

```typescript
const validCols = ['name','description','status','kind','priority','progressPercentage',
                   'startedAt','completedAt','claimedAt','agentId','originatingSkill','taskKind'];
const update = Object.fromEntries(
  Object.entries(safeFields).filter(([k]) => validCols.includes(k))
);
await db.update(tasksTable).set(update)...
```

After Step 4a: PATCH endpoints no longer crashed; only valid columns were updated.

---

## Missing Schema Columns

**Problem:** Hooks sent `agentId`, `originatingSkill`, `taskKind` but the `tasksTable` schema didn't have columns for them → values silently dropped.

**Fix (Step 5):** Added to `src/db/schema.ts`:

```typescript
agentId: text(),           // hex agent ID from SubagentStart
originatingSkill: text(),  // e.g. "/review-pr" from UserPromptSubmit hook
taskKind: text(),          // "orchestrator" | "work" | "background-task"
```

Then:

```bash
bunx drizzle-kit push  # Push new columns to database
```

After Step 5: Hooks could store and retrieve these metadata fields.

---

## Session Auto-Upsert

**Problem:** When hooks created a task with `sessionId`, the foreign key constraint expected the session to already exist in `sessionsTable`. If a session was created mid-hook (without a pre-session record), the task insert would fail or the constraint would be violated.

**Fix (Step 3b):** Before inserting a task, ensure its session exists:

```typescript
await db
  .insert(sessionsTable)
  .values({
    id: body.sessionId,
    type: 'auto',
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  .onConflictDoNothing();
```

After Step 3b: Orphaned tasks were prevented; FK integrity maintained.

---

## Hook Script Updates (Step 6)

Hook scripts needed three changes:

1. **Verb shift:** Change `PUT /tasks/:id` → `PATCH /tasks/:id` (REST convention; full replacement → partial update)
2. **Remove non-schema fields:** Strip `logs[]`, `events[]`, `dependencies[]` from payloads (server now whitelists)
3. **Fix response unwrapping:** Remove `.task` from jq expressions (server returns bare task, not wrapped)

**Files updated:**

- `scripts/pre-tool-agent.sh` — POST unchanged, strip logs/events
- `scripts/post-tool-agent.sh` — PUT → PATCH, remove logs/events
- `scripts/pre-tool-all.sh` — PUT → PATCH, remove `.task` wrapper from jq
- `scripts/post-tool-all.sh` — PUT → PATCH, remove `.task` wrapper from jq

After Step 6: Hook scripts spoke the new Hono/SQLite dialect.

---

## Key Learnings

### Defensive Access in Frontend

When an API contract changes (logs move from embedded to separate table), frontend code that assumed a shape must fail gracefully. Optional chaining (`?.`) + nullish coalescing (`??`) prevents crashes and allows incremental migration.

### API Contract as Contract

The response shape is a contract between backend and frontend. Changing it breaks everything downstream. Always version or wrap carefully.

### ID Stability Across Hooks

In a hook chain (pre → post → post-all), the task ID must be stable and match across all stages. Generating a new ID in the middle breaks the chain.

### Column Whitelisting

When accepting untrusted input (hook payloads), filter to known columns. Prevents SQLiteErrors and silently dropping unknowns.

### Schema as Source of Truth

If the schema adds a column, the frontend component type definition may need an update too. The database is the source of truth; the frontend type follows.

---

## Verification Checklist

After all steps, verify:

- [ ] `bun run dev` starts without errors
- [ ] Frontend loads without black screen
- [ ] `GET /tasks` returns 200 with array
- [ ] Dashboard shows recent tasks
- [ ] Triggering a Claude Code agent creates a task visible in dashboard
- [ ] Task status updates from "running" → "completed"/"failed"
- [ ] Session events panel shows events
- [ ] No 500 errors in Hono console output
- [ ] Hook script logs (at `logs/hooks.log`) show successful event appends

---

## What's Next

**Not yet implemented:**

- Eager-load logs from `logsTable` when fetching tasks (currently logs[] is empty)
- Fetch events from `sessionEventsTable` and attach to tasks (currently events[] is empty)
- Hook scripts still use shell + curl + jq; could be replaced with Node.js subagents

These are **Phase 2** enhancements (fuller log display, richer event tracking).
