# Senior Architect Plan: Plumbing → Kanban (2026-03-27)

## The Guiding Principle

A senior architect doesn't add rooms to a house with a cracked foundation. Before building
the Kanban feature, there are known data integrity problems that will spread into every row the
Kanban creates. Fix the source first, then build.

Think of it like a film shoot: you don't start rolling cameras if the set has structural
problems. You fix the set, verify it's solid, then call action.

---

## Pre-Flight: One Thing to Cross Off

**Kanban Step 0 (polling envelope bug) is already resolved.** The plan flags it as
"REQUIRED first" — but we confirmed the server already returns a raw array from `GET /tasks`,
and the defensive `Array.isArray()` check in `useTaskPolling.ts:72` handles both shapes.
Tasks are appearing in the dashboard. This step is done. Do not re-do it.

---

## Phase A — Fix the Foundation (Data Integrity First)

### A1. Session ID Plumbing

**What:** Hook scripts are stamping every task with yesterday's session ID instead of the
current Claude Code session ID.

**Why first:** The session ID is a foreign key — it's baked into every task row in the DB.
If Kanban tasks (`unassigned`, `claimed`) are created on top of this broken plumbing, they
inherit the wrong session ID too. Fixing it after the fact means retroactive data cleanup,
which is always harder than fixing it before building.

The session filter in the dashboard, chat history linking, and external shareability all
depend on this being correct. It's not a cosmetic issue — it's a correctness issue that
propagates to every consumer of task data.

**What needs to happen:**

- Identify which environment variable or state file Claude Code writes its persistent session
  ID to on session start
- Update hook scripts (`pre-tool-agent.sh`, `session-event.sh`) to read that value
- Verify new tasks created in a fresh session carry the correct, new session ID
- Confirm the Session dropdown in the dashboard shows a new entry for the new session

**How to verify:** Run an agent, then `curl http://localhost:3001/tasks` and confirm
`sessionId` matches the current Claude Code session, not a prior one.

---

## Phase B — Batch the Schema Changes

### B1. One Migration, Two Tables

**What:** Add `worktree_path` column (Kanban Step 2) AND create `hookEventsTable`
(TODO #2) in a single migration.

**Why batch:** Schema migrations are disruptive. Each one requires running
`bunx drizzle-kit push`, restarting the Hono server, and verifying nothing broke.
Doing two migrations when one will do is pure waste — you pay the migration cost twice for
no gain. A senior architect batches schema changes that are happening in the same phase.

**Why HookEvents belong here:** The `hookEventsTable` is a prerequisite for EventTrailRow
(TODO #3) — the per-task tool timeline in the UI. That feature is completely non-functional
right now because the server strips `events` from every PATCH body before it reaches SQLite.
Closing this during the Kanban migration phase means it doesn't become a separate future
effort.

**Migration contents:**

```sql
-- Kanban worktree support
ALTER TABLE tasks ADD COLUMN worktree_path text;

-- Hook events (tool call timeline per task)
CREATE TABLE hook_events (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  tool_name text NOT NULL,
  phase text NOT NULL,
  status text NOT NULL,
  summary text,
  timestamp text,
  completed_at text,
  model text
);
```

**After migration:** Update `server.ts` to insert `hookEventsTable` rows from PATCH bodies
instead of discarding them. Update `GET /tasks` (or a new `GET /tasks/:id/events` endpoint)
to return events alongside the task. EventTrailRow starts working.

---

## Phase C — Backend Before Frontend

Build the API and scripts layer before any UI. Each layer is independently testable before
the next is written. If you go UI first, nothing is testable until the whole stack is wired
up — bugs are impossible to isolate.

### C1. Types First (Kanban Step 1)

**What:** Add `'unassigned'`, `'claimed'` to `TaskStatus`; add `TaskPriority` type; extend
`Task` interface with `priority`, `description`, `claimedBy`, `claimedAt`, `worktreePath`,
`createdBy`.

**Why first in Phase C:** TypeScript contracts define the API. If you write the server
endpoints before the types, TypeScript can't catch mismatches between what the server
returns and what the UI expects. Types are the spec — write them before implementing against
them.

### C2. Server Endpoints (Kanban Step 3)

**What:** Add `GET /tasks/pool` and `POST /tasks/:id/claim` to `src/server.ts`.

**Why before scripts and UI:** The atomic claim endpoint is the **critical path** of the
entire Kanban feature. A senior architect validates the most complex, most risky piece early
— before anything depends on it. The `POST /tasks/:id/claim` endpoint uses SQLite WAL
atomicity to prevent race conditions (only one UPDATE matches when two agents race). This
logic must be proven correct with `curl` before a single script or component is written
against it.

**Critical ordering detail:** `GET /tasks/pool` must be declared **before** `GET /tasks/:id`
in Hono (first-match routing). Miss this and `/tasks/pool` gets swallowed by the `:id`
handler with `id = "pool"`. This is the kind of subtle bug that's painful to diagnose from
the UI layer.

**Verify with:**

```bash
# Post a test task directly
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -d '{"name":"Test pool task","sessionId":"...","status":"unassigned","priority":"high"}'

# Confirm it appears in pool
curl http://localhost:3001/tasks/pool

# Claim it
curl -X POST http://localhost:3001/tasks/<id>/claim \
  -H "Content-Type: application/json" \
  -d '{"claimedBy":"test-agent"}'

# Confirm 409 on second claim attempt
curl -X POST http://localhost:3001/tasks/<id>/claim \
  -H "Content-Type: application/json" \
  -d '{"claimedBy":"other-agent"}'
```

### C3. Shell Scripts + .gitignore (Kanban Steps 4, 9)

**What:** `scripts/post-task.sh`, `scripts/claim-task.sh`, add `worktrees/` to `.gitignore`.

**Why before UI:** Prove the full data flow works end-to-end via CLI before building the
visual layer on top. The `claim-task.sh` script creates a git worktree, writes
`TASK_CONTEXT.md`, and launches `claude` — that's a multi-step process with several failure
points. Validate each step in isolation before the UI depends on it.

Add `.gitignore` the same commit as the first worktree path is created. Never let worktrees
become accidentally committable.

**Verify with:**

```bash
bash scripts/post-task.sh "Fix login bug" "OAuth flow fails on Safari" high
# → task ID printed to stdout

bash scripts/claim-task.sh <task-id>
# → worktrees/agent/<branch>/ created
# → TASK_CONTEXT.md written
# → task moves to 'running' in dashboard
```

---

## Phase D — UI Layer Last

By this point: data is correct, API is verified, scripts work end-to-end. The UI is just
rendering. No surprises.

### D1. Badge Variants + Status Constants (Kanban Steps 5, 6)

**What:** Add `unassigned` and `claimed` variants to `badge.tsx`; add both statuses to all
constant maps in `taskConfig.tsx` (`STATUS_ICON`, `STATUS_LABEL`, `STATUS_TEXT`,
`STATUS_ORDER`, `PROGRESS_BAR`, `ALL_STATUSES`).

**Why before component:** `KanbanBoard.tsx` imports these constants immediately. Do these in
the same session as the component — treat them as prerequisites, not a separate step.

### D2. KanbanBoard Component (Kanban Step 7)

**What:** New `src/components/KanbanBoard.tsx` — four-column layout (Unassigned → Claimed →
In Progress → Done), `KanbanCard` with priority badge, Claim button, 409 handling.

**Why last of the feature work:** All the infrastructure is proven. The component just
renders what the API returns and calls endpoints that already work.

No drag-and-drop library. The only valid user-driven transition is claiming a task — a button
is clearer semantics than drag, and zero new dependencies.

### D3. View Toggle (Kanban Step 8)

**What:** `viewMode: 'table' | 'kanban'` state in `Dashboard.tsx`; segmented toggle in
`TaskTable.tsx` toolbar.

**Why last:** Lowest-risk change in the entire plan. It just switches which component
renders. Save the easiest thing for when everything else is proven to work.

---

## Complete Sequence

| # | Phase | What | Dependency |
|---|-------|------|------------|
| 1 | A | Fix session ID plumbing | None — fix before any new data is created |
| 2 | B | Batch migration: `worktree_path` + `hookEventsTable` | Session ID fixed |
| 3 | B | Wire HookEvents into server + EventTrailRow | Migration applied |
| 4 | C | Types: `unassigned`, `claimed`, `TaskPriority` | Migration done |
| 5 | C | Server: `GET /tasks/pool` + `POST /tasks/:id/claim` | Types defined |
| 6 | C | Shell scripts + `.gitignore` | Server endpoints verified via curl |
| 7 | D | Badge variants + status constants | Scripts verified |
| 8 | D | `KanbanBoard.tsx` | Constants ready |
| 9 | D | View toggle in Dashboard | KanbanBoard complete |

---

## Why This Is the Senior Architect's Choice

**1. Data integrity before features.** Bad data doesn't stay contained — it spreads to every
feature built on top of it. Session IDs in particular are cross-cutting: they affect filters,
history linking, external references, and future analytics.

**2. Batch schema changes.** Migrations are disruptive. Do them once per phase, not once per
feature.

**3. Bottom-up build order.** Data layer → API layer → script layer → UI layer. Each layer
is independently testable before the next is built. Bugs are isolated, not hidden.

**4. Validate the critical path early.** The atomic claim endpoint is the highest-risk piece.
Prove it works with `curl` before scripts or UI depend on it. If it's broken, you want to
know before you've built three layers on top of it.

**5. Lowest-risk last.** The view toggle is the easiest change. Save easy things for when
everything else is proven — it becomes a confidence-building final step, not a distraction.
