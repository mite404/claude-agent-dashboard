# Kanban Task Pool — Implementation Plan

## Context

The dashboard is being extended with a **Kanban task pool** so orchestrator agents can post
feature requests to a shared pool, and worker agents (or humans) can atomically claim one,
auto-create a git worktree from the current branch, and launch Claude inside it.

The SQLite migration (Phase 13) already added `claimedBy`, `claimedAt`, `priority`, and
`description` columns to `tasksTable`, and `'unassigned'`/`'claimed'` are already in
`VALID_STATUSES` in `src/server.ts`. The schema is ready; the UI and scripts are not.

---

## Build Order

### Step 0 — Fix polling envelope bug (REQUIRED first)

**File:** `src/hooks/useTaskPolling.ts:72`

```tsx
// Before (broken — rawTasks is { data: [] }, not an array)
const data: Task[] = Array.isArray(rawTasks) ? rawTasks.map(...) : [];

// After
const raw = rawTasks?.data ?? rawTasks;
const data: Task[] = Array.isArray(raw) ? raw.map((t: Task) => ({ ...t })) : [];
```

Same fix for `rawEvents` on line 80: server returns a plain array for sessionEvents,
so that one is fine — but verify after fixing tasks.

---

### Step 1 — Extend types (`src/types/task.ts`)

Add to `TaskStatus` union:

- `'unassigned'` — in pool, not yet claimed
- `'claimed'` — claimed, worktree being prepared

Add new type:

```tsx
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
```

Add to `Task` interface:

```tsx
priority?: TaskPriority;
description?: string;
claimedBy?: string | null;
claimedAt?: string | null;
worktreePath?: string | null;
createdBy?: string | null;
```

---

### Step 2 — Schema: add `worktreePath` column

**File:** `src/db/schema.ts` — add `worktreePath: text()` to `tasksTable`.

**Migration:** `drizzle/0001_kanban_worktree.sql`

```sql
ALTER TABLE tasks ADD COLUMN worktree_path text;
```

Run: `bunx drizzle-kit migrate`

---

### Step 3 — Server: two new endpoints (`src/server.ts`)

### 3a. `GET /tasks/pool`

Must be declared **before** `GET /tasks/:id` (Hono is first-match).

Returns only `unassigned` tasks, sorted by priority (urgent → high → normal → low),
then `createdAt` ascending. Used by agent scripts to list available work.

```tsx
app.get('/tasks/pool', async (c) => {
  const rows = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.status, 'unassigned'))
    .orderBy(
      sql`CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
      asc(tasksTable.createdAt)
    );
  return c.json({ data: rows });
});
```

### 3b. `POST /tasks/:id/claim` — Atomic claim

The critical piece. A single `UPDATE WHERE status='unassigned'` is atomic in SQLite WAL —
if two agents race, only one UPDATE matches; the other gets 0 rows back → 409.

```tsx
app.post('/tasks/:id/claim', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body?.claimedBy) return c.json({ error: 'claimedBy required' }, 400);

  const result = await db
    .update(tasksTable)
    .set({ status: 'claimed', claimedBy: body.claimedBy, claimedAt: new Date().toISOString() })
    .where(and(eq(tasksTable.id, id), eq(tasksTable.status, 'unassigned')))
    .returning();

  if (!result.length) {
    const existing = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing.length) return c.json({ error: 'task not found' }, 404);
    return c.json({ error: 'task already claimed', claimedBy: existing[0].claimedBy }, 409);
  }
  return c.json(result[0], 200);
});
```

---

### Step 4 — Shell scripts

### `scripts/post-task.sh` (NEW — orchestrator side)

Posts an unassigned task to the pool. Usage: `post-task.sh "<name>" "<description>" [priority]`

Key considerations:

- `sessionId` has a NOT NULL FK to `sessions`. Use `$KANBAN_SESSION_ID` env var;
script should create a stub orchestrator session row if the var is unset.
- Output the task ID to stdout so callers can capture it.
- Log to `logs/hooks.log` with `[post-task]` prefix.

### `scripts/claim-task.sh` (NEW — worker agent side)

Usage: `claim-task.sh <task-id> [agent-id]`

Flow:

1. `POST /tasks/:id/claim` → exit 1 on 409 (already claimed, pick another)
2. `GET /tasks/:id` → fetch name + description
3. `git worktree add worktrees/agent/<8chars>-<slug> -b agent/<8chars>-<slug>`
4. `PATCH /tasks/:id` → `{ status: 'running', worktreePath: '<path>', startedAt: now }`
5. Write `TASK_CONTEXT.md` to worktree root (name, priority, description)
6. `cd <worktree> && claude --dangerously-skip-permissions -p "$(cat TASK_CONTEXT.md)"`
7. On exit: `PATCH /tasks/:id` → `{ status: 'completed' | 'failed', completedAt, progressPercentage }`

Branch naming: `agent/<first-8-of-task-id>-<name-slug-max-30-chars>`
Worktree path: `<project-root>/worktrees/agent/<branch-name>`

Guard: `which claude || { log "ERROR: claude not found on PATH"; exit 1; }`

---

### Step 5 — Badge variants (`src/components/ui/badge.tsx`)

Add status dot + badge variants for `unassigned` and `claimed`:

```tsx
unassigned: 'bg-stone-900/60 text-stone-500 border border-stone-700/50'
claimed:    'bg-violet-950/60 text-violet-300 border border-violet-800/50'
```

---

### Step 6 — Status constants in `TaskTable.tsx`

Add `unassigned` and `claimed` to all constant maps:

- `STATUS_ICON`: `IconInbox` (unassigned), `IconUserCheck` (claimed) — from `@tabler/icons-react`
- `STATUS_TEXT`, `STATUS_ORDER`, `STATUS_LABEL`, `PROGRESS_BAR`, `ALL_STATUSES`

---

### Step 7 — `KanbanBoard.tsx` (NEW component)

**File:** `src/components/KanbanBoard.tsx`

Props: `{ tasks: Task[], onRefresh: () => void }`
Uses flat `tasks` array (not tree — Kanban is status-grouped, not hierarchical).

Four columns: **Unassigned** → **Claimed** → **In Progress** (running/paused/blocked) → **Done** (collapsed by default)

Within each column, cards sort by priority (`urgent` first).

`KanbanCard` shows: priority badge, task name, description preview (2-line clamp),
dependency count, `createdBy` (truncated), and a **Claim** button on unassigned cards only.

Claim button calls `POST /api/tasks/:id/claim` with `claimedBy: 'manual-<timestamp>'`.
On 409: surface a toast-style error (the task was just claimed by someone else).

No drag-and-drop library — the only valid user transition is claim. A button is
clearer than drag semantics and requires no dependency.

Layout: `grid grid-cols-4 gap-4 items-start` with `overflow-x-auto` on the wrapper.

---

### Step 8 — View toggle in `Dashboard.tsx` + `TaskTable.tsx`

In `Dashboard.tsx`:

- Add `viewMode: 'table' | 'kanban'` state (default `'table'`)
- Render `<KanbanBoard>` or `<TaskTable>` based on viewMode
- Pass `viewMode` + `onViewModeChange` to TaskTable

In `TaskTable.tsx` toolbar:

- Add segmented toggle: `IconLayoutList` (table) | `IconLayoutColumns` (kanban)
- Styled as a pill with active state highlight

---

### Step 9 — `.gitignore`

Add: `worktrees/`

---

## Files Changed

| File | Change |
| --- | --- |
| `src/hooks/useTaskPolling.ts` | Fix `{ data: [] }` envelope on line 72 |
| `src/types/task.ts` | Add `'unassigned'`, `'claimed'` to `TaskStatus`; add `TaskPriority`; extend `Task` interface |
| `src/db/schema.ts` | Add `worktreePath` column to `tasksTable` |
| `drizzle/0001_kanban_worktree.sql` | New migration — `ALTER TABLE tasks ADD COLUMN worktree_path text` |
| `src/server.ts` | Add `GET /tasks/pool` (before `:id`) + `POST /tasks/:id/claim` |
| `src/components/ui/badge.tsx` | `unassigned` + `claimed` variants |
| `src/components/TaskTable.tsx` | Status constant maps + view toggle UI |
| `src/components/KanbanBoard.tsx` | **New** — full Kanban board component |
| `src/components/Dashboard.tsx` | `viewMode` state, render switch, props to TaskTable |
| `scripts/post-task.sh` | **New** — orchestrator task posting script |
| `scripts/claim-task.sh` | **New** — atomic claim + worktree + Claude launch script |
| `.gitignore` | Add `worktrees/` |

---

## Verification

1. `bun run dev` — confirm dashboard loads with tasks visible (Step 0 fix)
2. `bash scripts/post-task.sh "Fix login bug" "The OAuth flow fails on Safari" high`
→ task appears in Kanban Unassigned column on next poll
3. Click **Claim** on a card → card moves to Claimed column
4. `bash scripts/claim-task.sh <task-id>` → confirm worktree created at
`worktrees/agent/<id>-<slug>`, TASK_CONTEXT.md present, task moves to In Progress
5. Race condition test: two terminal tabs both run `claim-task.sh <same-id>` simultaneously
→ only one succeeds; the other logs `WARN: could not claim task`
6. `bun run test` — existing tests pass; add a test for `computeBlockedState` with
`'unassigned'` dependency status
