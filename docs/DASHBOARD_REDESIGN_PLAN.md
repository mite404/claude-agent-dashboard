# Dashboard Redesign & Architecture Upgrade Plan

**Date Created**: 2026-03-10
**Status**: Planning
**Priority**: High

---

## 1. Problem Statement

The current dashboard architecture has reached its limits for the orchestrator-with-spawned-agents pattern:

### Current Limitations

1. **Race Conditions on Concurrent Updates**
   - db.json is a flat file watched by json-server
   - Multiple agents simultaneously reading and updating tasks can cause:
     - Lost writes (two agents patch the same task, one overwrites the other)
     - Dirty reads (agent reads task, then another agent modifies it before the first finishes)
   - No transaction semantics or atomic updates

2. **Session Hierarchy Invisible**
   - All sessions (orchestrator + spawned agents) appear as equals in the UI
   - No parent-child relationship shown
   - No way to see "which session spawned which agents"
   - Session context is implicit in the data, not explicit in the UI

3. **No Task Assignment/Claiming Workflow**
   - Tasks don't have ownership metadata
   - Agents can't query "what work is available for me?"
   - No way to prevent two agents claiming the same unassigned task
   - Orchestrator can't guide agents to specific work

4. **Limited Prioritization & Workflow Visibility**
   - No Kanban/column view for workflow states
   - Status updates are implicit in the data, not guided by the UI
   - No way to manually reprioritize work for the orchestrator
   - Hard to see high-level task flow at a glance

5. **Single Monolithic View**
   - TaskTable shows everything (tasks + logs + events + actions)
   - No dashboard/overview for high-level monitoring
   - No focused view for specific workflows (e.g., "show me only orchestrator tasks that need review")

---

## 2. Solution Architecture

### 2.1 Database Migration: JSON → SQLite

**Why SQLite**:
- ✅ ACID transactions (prevents race conditions)
- ✅ Atomic updates (patch one field, others are safe)
- ✅ Lightweight (no external process)
- ✅ Local-first (no network latency)
- ✅ Easy migrations (schema version control)
- ✅ Better query support (filtering, sorting at DB layer)

**Implementation**:
- Migrate json-server → custom Bun REST API (using `Bun.sqlite`)
- Same REST endpoint interface (backward compatible with hooks)
- Transactional updates: GET → PATCH becomes atomic UPDATE
- Schema versioning: `schema_version` table tracks migrations

**Schema**:

```sql
-- Core tables
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  type TEXT CHECK(type IN ('orchestrator', 'agent')),
  parent_session_id TEXT,
  model TEXT,
  agent_type TEXT,
  status TEXT CHECK(status IN ('running', 'idle', 'stopped')),
  created_at TEXT,
  stopped_at TEXT,
  FOREIGN KEY(parent_session_id) REFERENCES sessions(id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT CHECK(status IN ('unassigned', 'claimed', 'running', 'completed', 'failed', 'paused', 'cancelled', 'blocked')),
  kind TEXT CHECK(kind IN ('work', 'evaluation', 'planning')),
  priority TEXT CHECK(priority IN ('high', 'normal', 'low')),
  created_by TEXT, -- 'orchestrator' or agent_id
  claimed_by TEXT, -- agent_id that claimed this task
  progress_percentage INTEGER DEFAULT 0,
  created_at TEXT,
  started_at TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(parent_id) REFERENCES tasks(id)
);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_id TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(depends_on_id) REFERENCES tasks(id)
);

CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  timestamp TEXT,
  level TEXT CHECK(level IN ('info', 'warn', 'error', 'debug')),
  message TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT,
  timestamp TEXT,
  agent_id TEXT,
  agent_type TEXT,
  metadata JSON,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT
);
```

### 2.2 UI Architecture: Dashboard Redesign

**New Layout**:

```
┌──────────────────────────────────────────────────────────────────┐
│  Dashboard                          Refresh | Theme Toggle | ⚙️   │
├──────────────────────────────────────────────────────────────────┤
│  📊 Dashboard | 🎯 Kanban | 📋 Tasks | 📡 Sessions | ⚙️ Settings  │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ 🎯 KANBAN VIEW (Default)                                     │ │
│  ├──────────────┬──────────────┬──────────────┬─────────────────┤ │
│  │ UNASSIGNED   │ CLAIMED      │ IN PROGRESS │ BLOCKED         │ │
│  │              │              │             │                 │ │
│  │ ┌──────────┐ │ ┌──────────┐ │ ┌─────────┐ │ ┌─────────────┐ │ │
│  │ │Task A    │ │ │Task B    │ │ │Task D  │ │ │Task E       │ │ │
│  │ │High Prio │ │ │Agent-1   │ │ │Agent-2 │ │ │Waiting for C│ │ │
│  │ │[Move ▼]  │ │ │[60%]     │ │ │[80%]   │ │ │[Unblock]    │ │ │
│  │ └──────────┘ │ └──────────┘ │ └─────────┘ │ └─────────────┘ │ │
│  │              │              │             │                 │ │
│  │ ┌──────────┐ │              │ ┌─────────┐ │                 │ │
│  │ │Task F    │ │              │ │Task G  │ │                 │ │
│  │ │Normal    │ │              │ │Agent-3 │ │                 │ │
│  │ │[Move ▼]  │ │              │ │[40%]   │ │                 │ │
│  │ └──────────┘ │              │ └─────────┘ │                 │ │
│  │              │              │             │                 │ │
│  └──────────────┴──────────────┴─────────────┴─────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ COMPLETED (collapsible)                              ✔️ 7 done │ │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐                       │ │
│  │ │Task H    │ │Task I    │ │Task J    │                       │ │
│  │ │Agent-1   │ │Agent-2   │ │Agent-3   │                       │ │
│  │ └──────────┘ └──────────┘ └──────────┘                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

**View Modes**:

| View | Purpose | Default Elements |
|------|---------|------------------|
| **Dashboard** | Overview + metrics | Session health, active agents, task counts, blocked tasks, recent completions |
| **Kanban** | Workflow management | Columns: Unassigned, Claimed, Running, Blocked, Completed; drag-to-reprioritize |
| **Tasks** | Detailed task list | Sortable table with session/agent columns, claiming actions, log expansion |
| **Sessions** | Session hierarchy | Orchestrator + spawned agents tree, status per session, agent metrics |
| **Settings** | Preferences | View toggles, notification rules, theme, refresh rate |

### 2.3 Data Model Changes

**New Task Fields**:
- `status`: expanded from 7 to 8 states (added `unassigned`)
- `priority`: new field (high/normal/low) set by orchestrator via Kanban
- `claimed_by`: which agent claimed this task
- `claimed_at`: timestamp of claim
- `created_by`: who created the task (orchestrator or agent)

**New Session Entity**:
- `type`: orchestrator vs. agent
- `parent_session_id`: links spawned agent to orchestrator
- `status`: running / idle / stopped
- `agent_type`: agent subtype (e.g., "general-purpose", "Explore")

**Dropped Assumption**:
- No more "parentId for subtasks" — focus on tasks created by orchestrator to be worked on by agents
- Subtasks handled via `description` or future "task breakdown" feature

---

## 3. Implementation Phases

### Phase 1: SQLite + Drizzle Migration (2–3 days)

**Tasks**:
1. Install `drizzle-orm` and `drizzle-kit` (`bun add drizzle-orm drizzle-kit`)
2. Define schema in `src/db/schema.ts` (TypeScript, not SQL)
3. Create `src/db/index.ts` with Drizzle client initialization
4. Create `src/server.ts` (Bun REST API using Drizzle queries)
5. Write migration script: read db.json, insert into SQLite via Drizzle
6. Rewrite hook scripts to call new REST endpoints (same interface)
7. Remove json-server from `bun run dev`, start only `src/server.ts`
8. Add concurrent transaction tests (two agents claiming same task)

**Key Implementation Detail**:

Use Drizzle's `update().where()` for atomic operations:
```typescript
// This is atomic — both status AND claimedBy update together or neither does
await db
  .update(tasks)
  .set({ status: "claimed", claimedBy: agentId })
  .where(and(eq(tasks.id, id), eq(tasks.status, "unassigned")))
```

**Deliverable**:
- Same REST API endpoints (backward compatible with hooks)
- SQLite backend with Drizzle ORM
- Zero frontend changes
- Atomic updates prevent race conditions

**Risk Mitigation**:
- Keep db.json as backup for 1 week post-migration
- Validate record counts match after migration
- Run concurrent claim tests before going live

### Phase 2: Dashboard View & Session Hierarchy (3–4 days)

**Tasks**:
1. Add `sessions` table to schema
2. Create SessionStart/SessionEnd hook logic to write sessions
3. Build `<Dashboard />` component with metrics:
   - Active orchestrator + agent counts
   - Task counts by status
   - Recently completed tasks
   - Blocked tasks (dependencies incomplete)
4. Build `<SessionTree />` component:
   - Orchestrator at root
   - Spawned agents as children
   - Health indicator per session
   - Agent metrics (tasks claimed, completed, failed)

**Deliverable**: `/dashboard` route with session hierarchy + metrics

### Phase 3: Kanban Board (3–4 days)

**Tasks**:
1. Add `priority` field to tasks schema
2. Build `<KanbanBoard />` component:
   - Columns: Unassigned, Claimed, Running, Blocked, Completed
   - Card component: task name, priority, assigned agent, % progress
   - Drag-to-move between columns (updates `status` + `priority`)
   - Double-click to expand details
3. Task card actions:
   - Reassign to different agent
   - Set priority (high/normal/low)
   - Block/unblock
   - Quick view logs
4. Add sorting/filtering to columns (by priority, agent, created time)

**Deliverable**: `/kanban` route with full drag-drop workflow

### Phase 4: Task Assignment & Claiming (2–3 days)

**Tasks**:
1. Add `claimed_by`, `created_by`, `status: unassigned` to schema
2. Add task claiming endpoints:
   - `POST /api/tasks/:id/claim { agentId }` — atomic claim operation
   - Transactional check: if status == unassigned, set to claimed + claimed_by
3. Add orchestrator task creation:
   - Pre-hook now sets `status: unassigned` instead of `running`
   - Orchestrator can pre-populate work queue
   - Spawned agents query `/api/tasks?status=unassigned&sessionId=orchestrator` to find work
4. Update Kanban to show claimed_by agent
5. Update Tasks table to show created_by + claimed_by columns

**Deliverable**: Task claiming workflow end-to-end

### Phase 5: Focused Views & Settings (2 days)

**Tasks**:
1. Build `<Settings />` component:
   - View toggles: [✓] Show sessions, [✓] Show kanban, [✓] Show table, [ ] Show logs
   - Refresh rate slider (1s–30s)
   - Theme toggle
2. Persist view preferences to localStorage
3. Add URL query params for view state (e.g., `?view=kanban&filter=high-priority`)
4. Build focused dashboard variant that hides sections based on preferences

**Deliverable**: Configurable dashboard layout

### Phase 6: Testing & Polish (2–3 days)

**Tasks**:
1. Unit tests for concurrent task updates (SQLite transactions)
2. Integration tests for claim → update → complete flow
3. E2E test with real multi-agent scenario (orchestrator + 3 agents)
4. Performance tests (100+ tasks, 5 agents, concurrent updates)
5. Migration safety tests (db.json → SQLite round-trip)
6. Documentation updates (API, schema, migration guide)

**Deliverable**: Test suite + migration docs + production-ready

---

## 4. Technical Decisions

### Why Drizzle ORM + SQLite over other approaches

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Drizzle + SQLite (Bun)** | Type-safe, ACID, local-first, zero deps, TS-first, familiar API (Supabase-like) | Slight perf overhead (~0.2ms) vs raw SQL | ✅ Choose |
| Raw SQL + Bun.sqlite | Fastest, minimal overhead | Error-prone, no type safety, hard to read | ❌ Less safe |
| Prisma + SQLite | Popular, good migrations | Heavier, slower cold starts, less control | ❌ Overkill |
| PostgreSQL | Robust, production-grade | Overkill, requires external process | ❌ Too heavy |
| Turso (SQLite remote) | Sync-friendly, cloud backup | Requires auth, internet, costs | ❌ Add later |

**Why Drizzle specifically**:
- You already know it from Supabase/Postgres work
- Same query syntax (`.select().from().where()`) — zero learning curve
- Compile-time schema validation (catches typos at build time)
- Full TypeScript support (IDE autocomplete, type narrowing)
- Lightweight (no external dependencies beyond drizzle-orm itself)

### Kanban board as primary orchestrator interface

- **Why**: Visual task flow mirrors human mental model (backlog → in-progress → done)
- **Drag-to-move**: Faster than form dialogs for priority/status changes
- **Clear ownership**: Card shows "claimed by Agent-X" at a glance
- **Blocking visibility**: Unblock actions directly on the card

### Two-layer task lifecycle

1. **Orchestrator creates** → `status: unassigned` (pre-stage)
2. **Agent claims** → `status: claimed` (assignment)
3. **Agent works** → `status: running` (execution)
4. **Agent finishes** → `status: completed` (done)

This prevents agents from accidentally starting work on a task before the orchestrator has finished describing it.

---

## 5. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| SQLite race conditions (PRAGMA journal_mode) | Use WAL mode + explicit transactions + test concurrent writes |
| Data loss during migration | Keep db.json as backup for 1 week; validate record counts match |
| UI complexity (5 views × dashboard) | Build incrementally; start with Kanban only, add others as needed |
| Agent task discovery (agents don't know what's available) | Add `/api/tasks?status=unassigned&sessionId=orchestrator` endpoint for agents to poll |
| Kanban drag-drop UX (too much friction) | Use `react-beautiful-dnd` (proven, accessible) |
| Schema migrations breaking older agents | Version hook input/output, keep backward compat in first 2 phases |

---

## 6. Success Criteria

✅ **Phase 1 Complete**: No more concurrent write races; transactions work atomically
✅ **Phase 2 Complete**: Dashboard shows session hierarchy and task metrics correctly
✅ **Phase 3 Complete**: Kanban board drag-drop changes task status in real-time
✅ **Phase 4 Complete**: Agent can claim unassigned task; orchestrator sees claimed_by field
✅ **Phase 5 Complete**: User can toggle views; preferences persist
✅ **Phase 6 Complete**: 100+ tasks with 5 concurrent agents show no data corruption

---

## 7. Future Enhancements (Post-MVP)

- **Task breakdown**: Subtasks within tasks (parent-child relationships revisited)
- **Agent self-evaluation**: Agents can mark tasks "needs review" + provide reasoning
- **Orchestrator review workflow**: Review agents' work, approve/reject, provide feedback
- **Skills attribution**: Show which `/skill` created which tasks
- **Time tracking**: Task duration, SLA alerts (task running > 5 min)
- **Audit log**: Full history of who changed what, when
- **Export**: CSV/JSON export of task history for analysis
- **Webhooks**: Notify external systems (Slack, email) on task completion
- **Scaling**: Turso (remote SQLite) for multi-machine orchestration

---

## 8. Timeline Estimate

- **Phase 1**: 2–3 days (critical path blocker)
- **Phase 2**: 3–4 days
- **Phase 3**: 3–4 days (core feature)
- **Phase 4**: 2–3 days (orchestrator pattern enabler)
- **Phase 5**: 2 days
- **Phase 6**: 2–3 days

**Total**: 15–21 days (3 weeks) for MVP + testing

**Parallel opportunities**: Phases 2 & 3 can overlap once Phase 1 is done

---

## 9. Recommended Start

1. **Start with Phase 1** (SQLite) — foundational
2. **Run Phase 3 in parallel** (Kanban board design) — can target existing JSON schema first
3. **Complete Phase 2** (Session hierarchy) once Kanban is wired to the API
4. **Fast-follow with Phases 4–6** once core loop (orchestrator → kanban → agent → completion) is working

This approach gets you a functional demo (orchestrator guides agent via kanban, agent claims/completes work) within 7–10 days.
