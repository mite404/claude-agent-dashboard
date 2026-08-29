# Plan 004: Make the event trail deterministic, reusable, and tested

> **Executor instructions**: Follow this plan phase by phase. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. Do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat ee65481..HEAD -- src/server.ts src/db/index.ts src/types/task.ts
> ```
>
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding. On a mismatch, treat
> it as a STOP condition.

**Goal**: `GET /tasks` and `GET /tasks/:id` both return each task with its tool
events attached, in a guaranteed chronological order, through one shared pure
function that has its own test.

**Learning style**: read the concept, attempt the stub, take the quiz, then
consult the solution. The stubs are the lesson. Reading the solution first
costs you the exercise.

**Prerequisites**: you can read a `db.select().from(...)` chain. Everything else
is taught below.

---

## Table of contents

- [Status](#status)
- [Why this matters](#why-this-matters)
- [Current state](#current-state)
- [Commands you will need](#commands-you-will-need)
- [Concepts you will need](#concepts-you-will-need)
- [Scope](#scope)
- [Files you will touch](#files-you-will-touch)
- [Git workflow](#git-workflow)
- [Background concepts](#background-concepts)
- [Phase 1: Give the query an order](#phase-1-give-the-query-an-order)
- [Phase 2: Free the calculation from the action](#phase-2-free-the-calculation-from-the-action)
- [Phase 3: Test it without a database](#phase-3-test-it-without-a-database)
- [Test plan](#test-plan)
- [Done criteria](#done-criteria)
- [STOP conditions](#stop-conditions)
- [Maintenance notes](#maintenance-notes)
- [What you should know now](#what-you-should-know-now)
- [Stretch goals](#stretch-goals)
- [Advanced techniques and alternate solutions](#advanced-techniques-and-alternate-solutions)
- [Reference](#reference)

---

## Status

- **Initial priority**: P2
- **Effort**: M
- **Risk**: LOW. Additive. No existing response field changes meaning.
- **Depends on**: nothing. ETH-15 (health check) and ETH-17 (the attach itself)
  have both landed already - see below.
- **Category**: hardening + test coverage
- **Planned at**: commit `2e4fe1d`, 2026-08-23
- **Covers**: the three gaps left over after ETH-17's attach landed.

### Read this before you start: ETH-17 is already implemented

The headline of ETH-17 - "attach `hook_events` to `GET /tasks` so
`EventTrailRow` stops rendering empty" - is **done and working at HEAD**. The
attach lives at `src/server.ts:99-121`. It arrived in commit `211e5e4`, whose
subject line says "fix post-tool health check" and never mentions ETH-17, which
is why the ticket still looks open.

Proof, not vibes:

```bash
git log --oneline -S"eventsByTaskId" -- src/server.ts
# → 211e5e4 fix: standardize formatting and fix post-tool health check

sqlite3 data/dashboard.db "select count(*) from hook_events"
# → 42
```

`git log -S<string>` is the "pickaxe": it finds commits that added or removed
that exact text. It is how you date a line of code when nobody named the commit
after the ticket.

So this plan is **not** "build the attach". It is the three things the attach
did not finish. Close ETH-17 when this plan lands.

---

## Why this matters

Three separate problems, all in the same twenty lines of `src/server.ts`.

**1. The event trail's order is an accident.** The query at `src/server.ts:102`
has no `ORDER BY`. SQL makes no promise about row order without one. Today
SQLite happens to return rows in `rowid` order, which happens to match insert
order, which happens to match chronology - three coincidences stacked on top of
each other. Any of them can end. Add an index on `task_id` and SQLite may scan
the index instead of the table, handing you rows grouped by task in whatever
order the B-tree stores them. `VACUUM` rewrites the file and can renumber
rowids. When the Event Trail scrambles, nothing errors. It just quietly lies
about what the agent did in what order, which is the entire purpose of the
panel.

**2. `GET /tasks/:id` returns a different shape than `GET /tasks`.** The list
route hands back `Task & { events: HookEvent[] }`. The single route at
`src/server.ts:191-217` hands back the raw database row, so `events` is
`undefined`. Same declared TypeScript type, two different runtime shapes. No
caller hits this today, which is exactly why it is worth fixing now: the first
one that does will spend an afternoon on it.

**3. None of it is tested.** 133 tests pass and not one touches the grouping
logic. Someone could delete the `?? []` fallback at `src/server.ts:118` and the
suite stays green, while every task with zero events starts crashing
`EventTrailRow` on `events.filter(...)` of `undefined`.

---

## Current state

### The code being changed

**`src/server.ts:17-28`** - the row-to-domain converter. Read it, you will be
moving it in Phase 2.

```ts
/**
 * Convert a stored hook_events row into the HookEvent shape the frontend expects.
 * Storage allows nulls and names the column `timeStamp`; the domain type does not.
 */
const toHookEvent = (row: typeof hookEventsTable.$inferSelect): HookEvent => ({
  id: row.id,
  toolName: row.toolName ?? 'unknown',
  phase: (row.phase ?? 'pre') as HookEvent['phase'],
  status: row.status as HookEvent['status'],
  summary: row.summary ?? '',
  timestamp: row.timeStamp ?? '',
  completedAt: row.completedAt ?? undefined,
});
```

**`src/server.ts:99-121`** - the attach block inside `GET /tasks`. This is the
code all three phases operate on.

```ts
const ids = tasks.map((task) => task.id);

// fetch, filter hook_events table by task_id
const hookEventRows = await db
  .select()
  .from(hookEventsTable)
  .where(inArray(hookEventsTable.taskId, ids));

// group, build the taskId -> events[] lookup
const eventsByTaskId = new Map<string, Array<HookEvent>>();
for (const event of hookEventRows) {
  const bucket = eventsByTaskId.get(event.taskId) ?? [];
  bucket.push(toHookEvent(event));
  eventsByTaskId.set(event.taskId, bucket);
}

// attach, merge each task with it's events
const tasksWithEvents: Array<Task> = tasks.map((task) => ({
  ...task,
  events: eventsByTaskId.get(task.id) ?? [],
}));

return c.json(tasksWithEvents);
```

**`src/server.ts:191-217`** - `GET /tasks/:id`, which does none of the above.

```ts
const rows = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
// ... 404 guard ...
return c.json(rows[0]);
```

Two things to notice for later: it returns `rows[0]` raw, so it skips
`toTask()` as well as the events attach. And `id` here is a single string, not
an array.

**`src/server.ts:2`** - the Drizzle operators already imported. You will not
need to add one.

```ts
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
```

### The exemplar - do NOT edit this file

`src/lib/taskUtils.ts` is the pattern Phase 2 copies: a leaf module of pure
functions, importing nothing that opens a connection or holds state, with
`src/lib/taskUtils.test.ts` beside it. Read both. Change neither.

### Why `attachEvents` cannot live in `src/server.ts`

`src/db/index.ts:5` runs `new Database('data/dashboard.db')` at module scope.
Importing anything from `src/server.ts` therefore opens the real database file
and constructs a Hono app as a side effect of the import statement. A test that
only wants to check "does grouping put the right events on the right task"
would boot the entire backend to find out. Phase 2 exists to prevent that.

### Conventions

2-space indent, single quotes, arrow functions for pure helpers, JSDoc on
anything exported. Module order is `IMPORTS -> DATA -> CALCULATION -> ACTIONS
-> ORCHESTRATION`, leaf to trunk. Match it.

---

## Commands you will need

| Purpose              | Command                                                                                       | Expected on success                   |
| -------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| Typecheck            | `bunx tsc --noEmit`                                                                           | exit 0, no output                     |
| Lint                 | `bun run lint`                                                                                | exit 0, 6 pre-existing warnings       |
| Full test suite      | `bunx vitest run`                                                                             | 133 passed before, 137+ after Phase 3 |
| One test file        | `bunx vitest run src/lib/attachEvents.test.ts`                                                | that file's tests pass                |
| Start the API alone  | `bun run src/server.ts`                                                                       | listens on :3001                      |
| Start everything     | `bun run dev`                                                                                 | Vite :5173 + Hono :3001               |
| Read the list route  | `curl -s localhost:3001/tasks \| head -c 400`                                                 | JSON array, each item has `events`    |
| Read one task        | `curl -s localhost:3001/tasks/<id>`                                                           | JSON object, has `events` after Ph. 2 |
| Count stored events  | `sqlite3 data/dashboard.db "select count(*) from hook_events"`                                | non-zero (42 when planned)            |
| Inspect stored order | `sqlite3 data/dashboard.db "select rowid,time_stamp from hook_events order by rowid limit 8"` | ascending timestamps                  |
| Preflight: sqlite3   | `sqlite3 --version`                                                                           | any 3.x. Ships with macOS             |
| Preflight: bun       | `bun --version`                                                                               | >= 1.0                                |

---

## Concepts you will need

- **A `SELECT` without `ORDER BY` returns rows in an undefined order.** Needed
  because the event trail is a timeline, and a timeline in the wrong order is
  worse than no timeline. Taught in [Phase 1](#phase-1-give-the-query-an-order).
- **Action vs Calculation** (Grokking Simplicity). Needed because the grouping
  logic is a pure Calculation currently trapped inside an Action, and that is
  the only reason it has no test. Taught in
  [Background concepts](#background-concepts) and applied in
  [Phase 2](#phase-2-free-the-calculation-from-the-action).
- **Import-time side effects.** Needed because it is the concrete reason the
  extraction must go to a new file rather than staying in `src/server.ts`.
  Taught in [Phase 2](#phase-2-free-the-calculation-from-the-action).
- **ISO-8601 sorts correctly as plain text.** Needed to trust a text column in
  an `ORDER BY`. Taught in [Phase 1](#phase-1-give-the-query-an-order).

---

## Scope

**In scope** (the only files you may modify):

- `src/server.ts`
- `src/lib/attachEvents.ts` (new)
- `src/lib/attachEvents.test.ts` (new)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):

- **`GET /tasks/pool` at `src/server.ts:132`.** It serves the unassigned-task
  queue to `pre-tool-all.ts`, which never reads `events`. Attaching events there
  would be an unrequested query per poll. If a consumer ever needs it, that is a
  new ticket.
- **`toTask()` at `src/server.ts:34`.** Nothing outside `src/server.ts` calls
  it and no test wants it, so moving it is churn with no payoff. Phase 2 says
  more about why this one stays put.
- **`src/components/TaskTable.tsx`.** `EventTrailRow` already handles both the
  empty and populated cases correctly. Nothing to change.
- **`src/hooks/useTaskPolling.ts`.** The spread at line 72 already preserves
  `events`. Verified, leave it.
- **The `hook_events` schema.** No new columns, no index. The index question is
  a stretch goal with a measurement attached, not a guess to make today.
- **Writing an HTTP-level integration test.** Phase 3 deliberately tests the
  pure function instead. The reasoning is in Phase 3, and the HTTP version is
  offered as a stretch goal.

---

## Files you will touch

Build order is leaf to trunk: the pure module first, then its test, then the
routes that consume it.

| Order | Path                           | Role        | What it holds                                     | You   |
| ----- | ------------------------------ | ----------- | ------------------------------------------------- | ----- |
| -     | `src/lib/taskUtils.ts`         | exemplar    | The leaf-pure-module pattern Phase 2 copies       | Read  |
| -     | `src/lib/taskUtils.test.ts`    | exemplar    | The test-beside-the-module pattern Phase 3 copies | Read  |
| 1     | `src/lib/attachEvents.ts`      | Calculation | `toHookEvent` (moved) + `attachEvents` (new)      | Build |
| 2     | `src/lib/attachEvents.test.ts` | test        | Grouping, empty-bucket, order, no-mutation        | Build |
| 3     | `src/server.ts`                | Action      | `ORDER BY`; both routes call `attachEvents`       | Build |
| 4     | `plans/README.md`              | index       | One status row for this plan                      | Build |

---

## Git workflow

- Branch `<user>/<slug>`, e.g. `mite404/deterministic-event-trail`.
- One commit per phase. The phases are deliberately separable:

  ```text
  fix: order hook events by timestamp in GET /tasks
  refactor: extract attachEvents and reuse it in GET /tasks/:id
  test: cover attachEvents grouping and empty buckets
  ```

- Do NOT push or open a PR unless the operator instructed it.
- You are on `gitbutler/workspace`. Create the branch inside GitButler, not with
  bare `git checkout -b`, and never push `gitbutler/workspace` itself.

---

## Background concepts

### Action, Calculation, Data (first principles)

Grokking Simplicity sorts every line of code into three buckets. The film-set
version of the map:

- **Data** is _footage_. Inert. A frame on disk is the same frame whether you
  look at it now or next Tuesday. In this codebase: the `HookEvent` interface,
  a row object, the `VALID_STATUSES` array.
- **Calculation** is a _LUT_ (a color lookup table). Feed the same frame
  through it a thousand times, get the same graded frame a thousand times. It
  cannot know what time it is, cannot phone anyone, cannot remember the last
  frame. In this codebase: `toHookEvent`, `buildTree`, everything in
  `src/lib/taskUtils.ts`.
- **Action** is a _live take_. The result depends on when you rolled and who
  was on set. Run it twice, get two different things. In this codebase:
  `db.select()`, `fetch()`, `c.json()`, the whole route handler.

**Which bucket is this line in? Three questions:**

1. Does calling it twice with identical arguments give an identical result?
   No -> Action.
2. Does it read or write anything outside its own arguments? The database, the
   clock, a module-level variable, the filesystem? Yes -> Action.
3. Otherwise it is a Calculation. If it has no behavior at all, it is Data.

**The preference rule: prefer Data to Calculations, and Calculations to
Actions.** Not because Actions are bad - the program is useless without them -
but because Actions are the expensive ones. An Action needs a running database
to test. A Calculation needs an array. Every line you move from the Action
bucket to the Calculation bucket is a line you can verify in a millisecond with
no setup.

Now look at `src/server.ts:99-121` with that map in hand:

```ts
const hookEventRows = await db.select()...           // ACTION      (touches DB)
const eventsByTaskId = new Map(...); for (...) {...} // CALCULATION (trapped)
const tasksWithEvents = tasks.map(...)               // CALCULATION (trapped)
return c.json(tasksWithEvents);                      // ACTION      (writes response)
```

The two middle steps are pure. They take arrays in and give an array out. They
are only untestable because they are sitting inside a function that opens a
database. Phase 2 rests on that: **the fix is not to make the Action testable,
it is to move the Calculation out of it.**

### The grouping shape: `Map<K, V[]>`

A join in application code. Instead of walking every event once per task -
`tasks.length * events.length` comparisons, the classic N-squared - you walk the
events once to build an index, then each task does one `Map.get`, which is
roughly constant time.

```text
rows: [ {task: A, tool: Bash}, {task: B, tool: Read}, {task: A, tool: Edit} ]
                       |
                       | one pass, bucket by task_id
                       v
map:  A -> [Bash, Edit]
      B -> [Read]
                       |
                       | one .get per task
                       v
out:  [ {...A, events: [Bash, Edit]}, {...B, events: [Read]}, {...C, events: []} ]
```

Task C never appeared in the rows. It still gets a key, and the value is `[]`,
not `undefined`. That `?? []` is the expression a reader is most likely to call
redundant and delete. Phase 3 writes the test that stops them.

---

## Phase 1: Give the query an order

**Concepts**: undefined result order in SQL; why ISO-8601 sorts as text.

### Concept: a query without `ORDER BY` has no order

**What is it?** Picture a day's dailies coming back from the lab. You get a box
of clips. Nothing about "the lab returns clips" promises the box is in shooting
order - if the loader pulled bins from the back of the rack, that is the order
you get. This is exactly why every clip carries a **slate**: the timecode is
printed on the frame so the assistant editor can sort them, no matter how the
box arrived.

The jargon: SQL's `SELECT` returns a **multiset**, a bag of rows with no
inherent sequence. `ORDER BY` is the only thing that puts a sequence on it.
`time_stamp` is our slate.

**Why does it matter here?** `src/server.ts:102-105` has no `ORDER BY`, so
today's correct-looking output is three coincidences deep:

```text
rows come back in rowid order   (an implementation detail of a table scan)
  -> rowid order == insert order (true only until a VACUUM renumbers)
    -> insert order == chronological (true only because hooks fire in sequence)
```

Adding an index on `task_id` is a reasonable future optimization. It can also
make SQLite scan that index instead of the table, and the coincidence dies.
Nothing throws. The Event Trail just starts showing the `Write` before the
`Read` that produced its content.

**How it works.** Drizzle's `.orderBy()` appends the clause to the generated
SQL, so SQLite does the sorting inside the query plan. You could instead sort
the array in JavaScript afterward. Prefer the database: it can sort using an
index without loading the whole set into memory, and the guarantee then belongs
to the query itself rather than to a separate line somebody can delete.

**The text-column question.** `time_stamp` is `text`, not a date type - SQLite
has no date type. Sorting text is lexicographic: character by character. That is
usually a trap (`"10" < "9"`). Here it is safe, for this reason:

```text
2026-08-21T06:22:20.601Z
^^^^ ^^ ^^ ^^ ^^ ^^ ^^^
 |    |  |   fixed width, zero-padded, largest unit first
 |    |  |
 └────┴──┴─> comparing these as text gives the same answer as comparing
             them as moments in time
```

Big-endian and zero-padded is not an aesthetic choice in ISO-8601. The format
was designed that way so lexicographic order would equal chronological order,
which is what makes a dumb text sort a correct time sort.

### Step 1.1: The stub

In `src/server.ts`, inside `GET /tasks`:

```ts
// CATEGORY: Action - reads the database. The ordering guarantee belongs
// in the query, not in a follow-up sort.
const hookEventRows = await db
  .select() // → HookEventRow[]
  .from(hookEventsTable)
  .where(inArray(hookEventsTable.taskId, ids));
// TODO(you): chain one more clause so the rows come back oldest-first.
//   - Which column carries the chronology? Check the schema at
//     src/db/schema.ts and note it is NOT spelled the same in TS as in SQL.
//   - Which direction helper do you need, and is it already imported?
//     Look at src/server.ts line 2 before you add an import.
//   - Drizzle's clause helpers are all chained the same way. You have
//     already used .from() and .where() in this very statement.
```

### Step 1.2: Work through it

**Conceptual process.** You need three things: the method, the column, the
direction helper. The method follows the `.from().where()` chain you are already
looking at. The column is the one holding an ISO timestamp - mind the casing:
the schema names the property `timeStamp` while SQLite spells the column
`time_stamp`, and `src/db/index.ts:13` (`casing: 'snake_case'`) is what
translates between them. You always write the TypeScript name. The direction
helper is one of Drizzle's two, and line 2 already imports one of them.

**Why this approach?** The alternative is `.sort()` on the returned array. It
gives the same answer today for 42 rows. It loses on three counts: the sort is
now a separate statement that can be deleted independently of the query, it
cannot use an index if one ever exists, and it forces the entire result set into
memory before ordering. The database is the right place for this.

### Step 1.3: Quiz yourself

1. If you added an index on `hook_events(task_id)` tomorrow, would the current
   un-ordered query return rows in a different order? What would _tell_ you it
   had changed - what error appears in the console?
2. `time_stamp` is a text column. Why does `ORDER BY time_stamp` sort correctly
   when `ORDER BY` on a text column holding `"9"` and `"10"` does not?
3. `toHookEvent` reads `row.timeStamp`, and the SQLite column is `time_stamp`.
   Which line of which file makes those the same thing?
4. You have 42 events across 3 tasks. Sorting all 42 by timestamp puts events
   from different tasks next to each other in `hookEventRows`. Does that break
   the grouping loop that runs immediately after? Why or why not?

### ✅ Solution

Consult only after attempting.

```ts
// CATEGORY: Action - reads the database.
const hookEventRows = await db
  .select() // → HookEventRow[]
  .from(hookEventsTable)
  .where(inArray(hookEventsTable.taskId, ids)) // → filtered
  .orderBy(asc(hookEventsTable.timeStamp)); // → oldest-first
```

`asc` was already on line 2. No new import.

Quiz answers: (1) Yes, and _nothing_ tells you - no error, no warning, just a
scrambled panel. That silence is the whole reason this is worth fixing.
(2) ISO-8601 is fixed-width and zero-padded with the largest unit first, so
lexicographic order equals chronological order; `"9"` vs `"10"` fails precisely
because it is neither fixed-width nor padded. (3) `src/db/index.ts:13`,
`casing: 'snake_case'`. (4) It does not break it. The loop buckets by
`event.taskId` regardless of what order it meets the rows in, and because the
input is globally sorted, each bucket comes out sorted too. Sorting a
concatenation sorts every subsequence of it.

### Step 1.4: Run it

```bash
bunx tsc --noEmit && bun run src/server.ts &
sleep 2 && curl -s localhost:3001/tasks | head -c 400
```

**Expected output**: a JSON array; the first task object contains an `events`
key whose entries ascend by `timestamp`.

**If it fails**: `Cannot find name 'asc'` means you added the call but the
import on line 2 lost it - check you did not overwrite the line. `no such
column` means you passed the SQL name (`time_stamp`) where the TypeScript
property (`timeStamp`) belongs.

### ✅ Phase 1 complete

**You have learned**: row order is a guarantee you must ask for, not a property
of the table; sorting belongs in the query rather than after it; ISO-8601's
shape is what makes a text sort a valid time sort.

**Next**: the grouping code that runs on those rows is pure, and it is stuck
inside a function that cannot be tested. Phase 2 gets it out.

---

## Phase 2: Free the calculation from the action

**Concepts**: Action vs Calculation; import-time side effects; reuse over
re-derive; when _not_ to extract.

### Concept: the calculation is already there, it is just trapped

**What is it?** In a color suite, the LUT is a separate file. It is not welded
into the camera. That separation is what lets you check the LUT on a test chart
in ten seconds instead of re-shooting the scene to see whether the grade is
right.

The jargon: **extracting a Calculation from an Action**. The Action
(`GET /tasks`) keeps the parts that genuinely need the world - the database
read, the JSON response. The Calculation (grouping and attaching) moves out to
a module that needs nothing but its arguments.

**Why does it matter here?** Two payoffs, and they are the two remaining gaps
from the "Why this matters" section.

_Reuse._ `GET /tasks/:id` needs the identical grouping. Right now it would have
to copy the loop. Two copies of a join drift - somebody fixes the `?? []`
fallback in one and not the other, and the single-task route starts returning
`undefined` where the list route returns `[]`.

_Testability._ This is the one worth slowing down for.
`src/db/index.ts:5` runs `new Database('data/dashboard.db')` **at module
scope** - the moment the file is imported, before any function is called. So:

```text
import { anything } from '../server'
        |
        v
  server.ts's imports run
        |
        v
  db/index.ts's module body runs
        |
        v
  new Database('data/dashboard.db')   <- a real file opens, from an import
```

A test that only wants to ask "does grouping put the right events on the right
task" would open the production database to find out. Grouping needs two arrays,
not a database. It pays that cost only because of where the code sits. Move the
Calculation to a leaf module and the import chain stops reaching
`src/db/index.ts`.

**How it works.** New file `src/lib/attachEvents.ts` holding two functions:
`toHookEvent` (moved verbatim from `src/server.ts:20`) and `attachEvents` (the
loop plus the map, lifted into a function). It imports only types plus the
schema table for its row type. `src/db/schema.ts` declares tables; it does not
open a connection, so importing it is free.

Module order, leaf to trunk: `IMPORTS -> DATA -> CALCULATION -> ACTIONS ->
ORCHESTRATION`. This file stops at CALCULATION, which is what makes it a leaf.

### Concept: when NOT to extract

`toTask` at `src/server.ts:34` is also a pure Calculation. Leave it exactly
where it is.

The rule that distinguishes them is not "is it pure". It is **is something
actually asking for it**:

|                         | `toHookEvent`            | `toTask` |
| ----------------------- | ------------------------ | -------- |
| Pure?                   | yes                      | yes      |
| Second caller wants it? | yes - `/tasks/:id`       | no       |
| A test wants it?        | yes - via `attachEvents` | no       |
| **Move it?**            | **yes**                  | **no**   |

Extracting `toTask` too would look tidier and buy nothing: one more file to
open when reading the route, one more import, one more place for a stale
comment to hide. Extraction has a cost, and "it is pure" is not on its own a
reason to pay it. Wait for the second caller.

### Step 2.1: The stub - `src/lib/attachEvents.ts`

Create the file:

```ts
// ─── IMPORTS ──────────────────────────────────────────────────────────────
import type { hookEventsTable } from '../db/schema';
import type { HookEvent, Task } from '../types/task';

// ─── DATA ─────────────────────────────────────────────────────────────────

/** A raw row as SQLite stores it: nullable columns, `timeStamp` casing. */
type HookEventRow = typeof hookEventsTable.$inferSelect;

// ─── CALCULATION ──────────────────────────────────────────────────────────

// CATEGORY: Calculation - same row in, same HookEvent out, every time.
// Moved verbatim from src/server.ts:20. Do not change its behavior here;
// a move and an edit in one commit is a move you cannot review.
/**
 * Convert a stored hook_events row into the HookEvent shape the frontend expects.
 * Storage allows nulls and names the column `timeStamp`; the domain type does not.
 */
export const toHookEvent = (row: HookEventRow): HookEvent => ({
  // TODO(you): paste the body from src/server.ts:21-28, unchanged.
});

// CATEGORY: Calculation - no DB, no clock, no module state. Two arrays in,
// one array out. This is the function Phase 3 tests.
/**
 * Attach each task's hook events, grouped by task id.
 *
 * @param tasks - tasks in the order they should be returned
 * @param rows - hook_events rows for those tasks, already sorted by caller
 * @returns the same tasks, same order, each with an `events` array
 */
export const attachEvents = (tasks: Task[], rows: HookEventRow[]): Task[] => {
  // TODO(you): implement in two passes.
  //
  //   Pass 1 - index the rows.
  //     Build a lookup keyed by the row's task id. What collection type gives
  //     you constant-time get-by-key and preserves insertion order of values?
  //     Each key's value is a list, so you need a "get the existing list or
  //     start a new one" step before you push. Which operator writes
  //     "or start a new one" in one character pair?
  //
  //   Pass 2 - attach.
  //     Map over `tasks` and give each one an `events` field from the lookup.
  //     A task with no rows must get an empty array, NOT undefined - go read
  //     src/components/TaskTable.tsx:306 and the line just below it to see
  //     what breaks otherwise. That single fallback is what Phase 3 tests.
  //
  //   Do not mutate the input. Ask yourself which of `{...task, events}` and
  //   `task.events = events` mutates the caller's objects, and what that
  //   would do to `computeBlockedState` in useTaskPolling.ts, which already
  //   mutates tasks in place for its own reasons.
  return []; // remove when implemented
};
```

### Step 2.2: Work through it

**Conceptual process.** The body you need already exists at
`src/server.ts:107-119`. This is not a rewrite, it is a lift: same two passes,
now taking `tasks` and `rows` as parameters instead of closing over them. Do the
move first, get it compiling, then read your own code and ask whether the
signature is honest - does the JSDoc's "already sorted by caller" match what
Phase 1 guarantees?

**Why split it this way?**

- **Which bucket?** Calculation. Apply the three questions: same arguments give
  the same result, yes; reads nothing outside its arguments, correct; therefore
  Calculation.
- **How can you tell?** Grep the body for `await`, `db`, `Date`, `fetch`, and
  `Math.random`. Five names, zero hits. The function cannot find out what time
  it is or what is in the database, so it cannot vary between two calls.
- **What got easier?** Three things. `GET /tasks/:id` gets the behavior by
  calling one function instead of copying thirteen lines. The test in Phase 3
  needs no database, no server, no fixtures, and no mocking library. And the
  route handler shrinks to the parts that genuinely need the world, so reading
  it tells you what it talks to.

### Step 2.3: The stub - rewire both routes

In `src/server.ts`, `GET /tasks`:

```ts
// CATEGORY: Action - DB read + response write. Everything between them
// has moved out.
const hookEventRows = await db
  .select()
  .from(hookEventsTable)
  .where(inArray(hookEventsTable.taskId, ids))
  .orderBy(asc(hookEventsTable.timeStamp)); // → HookEventRow[], sorted

// TODO(you): replace the Map loop and the .map() attach - all of
// src/server.ts:107-119 - with one call. Then delete toHookEvent from this
// file; it lives in the lib module now. Watch for two things tsc will tell
// you about: an unused import, and the `HookEvent` type import that may no
// longer be needed here.
return c.json(/* → Task[] with events */);
```

And `GET /tasks/:id`:

```ts
const rows = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
if (rows.length === 0) {
  console.error('Task not found:', id);
  return c.json({ error: 'task not found' }, 404);
}

// TODO(you): give this route the same shape as GET /tasks.
//   - Fetch this one task's events. `id` is a single string here, not an
//     array, so the list route's operator is not the natural fit. Which
//     Drizzle operator compares one column to one value? It is already
//     imported and already used two lines above you.
//   - Order them the same way. If you find yourself typing the same
//     .orderBy() a second time, that is fine - two is not yet a pattern.
//     Note it and move on; the Maintenance notes say when to revisit.
//   - Call attachEvents. It takes an array of tasks. You have one task.
//     What do you pass, and what do you take back out?
//   - This route currently returns rows[0] raw, skipping toTask(). Decide
//     whether to fix that here or leave it. Whichever you choose, say why
//     in the commit body - a deliberate omission and an oversight look
//     identical in a diff.
return c.json(/* → Task with events */);
```

### Step 2.4: Quiz yourself

1. `attachEvents` takes `rows` as a parameter rather than querying for them
   itself. Name the one thing that would become impossible if it did the query
   internally.
2. Both `attachEvents` and `computeBlockedState` (`useTaskPolling.ts:6`)
   process an array of tasks. One returns a new array, the other mutates in
   place and returns `void`. Which is the Calculation, and what does the other
   one being an Action cost you when you want to test it?
3. If you had put `attachEvents` at the top of `src/server.ts` instead of in
   `src/lib/`, exactly what happens when Vitest runs
   `import { attachEvents } from '../server'`? Trace it to the specific line
   of the specific file.
4. `toTask` is pure and you are leaving it in `src/server.ts`. Give the
   concrete condition under which you would move it later.

### ✅ Solution

`src/lib/attachEvents.ts`:

```ts
// ─── IMPORTS ──────────────────────────────────────────────────────────────
import type { hookEventsTable } from '../db/schema';
import type { HookEvent, Task } from '../types/task';

// ─── DATA ─────────────────────────────────────────────────────────────────

type HookEventRow = typeof hookEventsTable.$inferSelect;

// ─── CALCULATION ──────────────────────────────────────────────────────────

/**
 * Convert a stored hook_events row into the HookEvent shape the frontend expects.
 * Storage allows nulls and names the column `timeStamp`; the domain type does not.
 */
export const toHookEvent = (row: HookEventRow): HookEvent => ({
  id: row.id, // → string
  toolName: row.toolName ?? 'unknown', // → string
  phase: (row.phase ?? 'pre') as HookEvent['phase'], // → 'pre'|'post'
  status: row.status as HookEvent['status'], // → HookEvent status
  summary: row.summary ?? '', // → string
  timestamp: row.timeStamp ?? '', // → string
  completedAt: row.completedAt ?? undefined, // → string|undefined
});

/**
 * Attach each task's hook events, grouped by task id.
 *
 * @param tasks - tasks in the order they should be returned
 * @param rows - hook_events rows for those tasks, already sorted by caller
 * @returns the same tasks, same order, each with an `events` array
 */
export const attachEvents = (tasks: Task[], rows: HookEventRow[]): Task[] => {
  const eventsByTaskId = new Map<string, HookEvent[]>(); // → empty index
  for (const row of rows) {
    const bucket = eventsByTaskId.get(row.taskId) ?? []; // → HookEvent[]
    bucket.push(toHookEvent(row)); // → HookEvent[]
    eventsByTaskId.set(row.taskId, bucket); // → Map updated
  }

  return tasks.map((task) => ({
    // → Task[]
    ...task, // → copy, no mutation
    events: eventsByTaskId.get(task.id) ?? [], // → HookEvent[]
  }));
};
```

`src/server.ts`, `GET /tasks`:

```ts
const hookEventRows = await db
  .select()
  .from(hookEventsTable)
  .where(inArray(hookEventsTable.taskId, ids))
  .orderBy(asc(hookEventsTable.timeStamp)); // → HookEventRow[]

return c.json(attachEvents(tasks, hookEventRows)); // → Task[] with events
```

`src/server.ts`, `GET /tasks/:id`:

```ts
const eventRows = await db
  .select()
  .from(hookEventsTable)
  .where(eq(hookEventsTable.taskId, id)) // → one task's rows
  .orderBy(asc(hookEventsTable.timeStamp)); // → sorted

const [task] = attachEvents([toTask(rows[0])], eventRows); // → Task
return c.json(task);
```

Also delete `toHookEvent` from `src/server.ts` and add
`import { attachEvents, toHookEvent } from './lib/attachEvents';` - drop
`toHookEvent` from that import if nothing else in the file uses it, and let
`tsc` tell you.

Note that the solution _does_ run `rows[0]` through `toTask()`. That is the
judgment call the stub left open: `GET /tasks` returns `toTask`-normalized
objects, so a single-task route that skips it hands back a subtly different
shape - the exact class of bug this plan exists to close. Say so in the commit
body.

Quiz answers: (1) Testing it without a database. The moment it queries, it is
an Action. (2) `attachEvents` is the Calculation. `computeBlockedState` mutates,
so a test must construct input, call it, then inspect the _input_ rather than a
return value, and any other assertion in the same test file is now reading
tampered objects. (3) `import` resolves `../server` -> `server.ts` runs its
imports -> `./db/index` runs its module body -> `src/db/index.ts:5` executes
`new Database('data/dashboard.db')` and the real file opens. (4) When a second
caller or a test needs it. `GET /tasks/pool` would qualify if it ever
normalizes its rows.

### Step 2.5: Run it

```bash
bunx tsc --noEmit && bun run lint && bun run src/server.ts &
sleep 2
curl -s localhost:3001/tasks | head -c 200
curl -s "localhost:3001/tasks/$(sqlite3 data/dashboard.db 'select id from tasks limit 1')"
```

**Expected output**: the list route unchanged from Phase 1; the single-task
route now returns an object with an `events` array instead of a bare row.

**If it fails**: `attachEvents is not a function` means the import path is
wrong - it is `./lib/attachEvents` from `src/server.ts`, no extension.
`Property 'events' does not exist` means you are spreading a row rather than a
`Task`; run it through `toTask` first. If `tsc` flags `HookEvent` as unused in
`src/server.ts`, delete the import - that is the extraction working.

### ✅ Phase 2 complete

**You have learned**: a pure function inside an Action is untestable by
association, not by nature; import-time side effects are what make "just import
it in the test" fail; extract when a second caller or a test asks, and not
before.

**Next**: the extraction bought you a test that needs no setup at all. Phase 3
collects.

---

## Phase 3: Test it without a database

**Concepts**: why a pure function needs no dependency injection; testing the
fallback, not the happy path.

### Concept: the test you did not have to fake

**What is it?** When a function talks to the outside world, the standard move is
**dependency injection**: pass the database in as a parameter so the test can
hand it a fake.

```ts
// If attachEvents had done its own query, DI would be the only way to test it:
const attachEvents = async (tasks: Task[], client: DbClient) => { ... };
attachEvents(tasks, fakeClient);   // test passes a stand-in
```

DI is a good technique and this codebase will need it eventually. Notice what
Phase 2 did to the need for it here: `attachEvents` has no dependency to
inject. There is no fake to write, no mocking library to configure, no cleanup
between tests. The arrays _are_ the fixture.

That is the point worth carrying out of this plan. **DI makes an Action
testable; extraction makes it not an Action.** When you have the choice, take
the second one. Reach for DI when the function genuinely must do I/O - a route
handler, a hook script - and cannot be split further.

**Why does it matter here?** Gap 3 from "Why this matters": nothing protects
the `?? []` fallback. And a happy-path test would not protect it either. If
every task in your fixture has events, the fallback never executes and you can
delete it with the suite still green. **Test the branch that is easy to
delete.**

**How it works.** `src/lib/attachEvents.test.ts`, beside the module, matching
`src/lib/taskUtils.test.ts`. Vitest runs jsdom (`vite.config.ts`), which is
irrelevant here - a pure function does not care what globals exist.

### Step 3.1: The stub

```ts
// ─── IMPORTS ──────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { attachEvents } from './attachEvents';
import type { Task } from '../types/task';

// ─── DATA ─────────────────────────────────────────────────────────────────
// CATEGORY: Data - inert fixtures. No factory, no builder; three literals
// are cheaper to read than a helper that constructs them.

const task = (id: string): Task =>
  ({
    id,
    name: id,
    status: 'running',
    agentType: 'general-purpose',
    createdAt: '',
    progressPercentage: 0,
  }) as Task;

const row = (id: string, taskId: string, timeStamp: string) => ({
  id,
  taskId,
  toolName: 'Bash',
  phase: 'pre',
  status: 'completed',
  summary: '',
  timeStamp,
  completedAt: null,
});

// ─── TESTS ────────────────────────────────────────────────────────────────

describe('attachEvents', () => {
  it('groups events onto the task they belong to', () => {
    // TODO(you): two tasks, three rows - two for the first task, one for the
    // second. Assert each task received the right count. Which matcher family
    // reads best for "this array has N items"?
  });

  it('gives a task with no events an empty array, not undefined', () => {
    // TODO(you): this is the one that matters. A task, zero rows.
    // Assert on the VALUE, not just on truthiness - a test written as
    // `expect(result[0].events).toBeFalsy()` passes for undefined too,
    // which is exactly the bug. What does EventTrailRow's `.filter()` call
    // at TaskTable.tsx:325 do to undefined? Write the assertion that fails
    // if someone deletes the `?? []`.
  });

  it('preserves the order the rows arrived in', () => {
    // TODO(you): attachEvents does not sort - Phase 1 made the DB do that.
    // So this test pins the contract "order in equals order out". Pass rows
    // out of chronological order deliberately and assert they come back in
    // the order you passed them, not in timestamp order.
    // Ask yourself first: is asserting that the RIGHT contract, or should
    // attachEvents sort defensively? Decide, then write the test that
    // matches your decision.
  });

  it('does not mutate the tasks it was given', () => {
    // TODO(you): hold a reference to the input task object. Call
    // attachEvents. Assert the ORIGINAL still has no events key.
    // Which matcher distinguishes "same contents" from "same object"?
    // You want the one that proves a copy was made.
  });
});
```

### Step 3.2: Work through it

**Conceptual process.** Write the empty-bucket test first. It is the one with a
real bug behind it, and writing it first means you find out immediately whether
your Phase 2 implementation actually has the fallback. Then grouping, then
order, then mutation.

For the order test, the stub asks you to make a decision before writing an
assertion. Both answers defend: "the caller sorts, we preserve" keeps the
function minimal and puts the guarantee in one place (the query, from Phase 1);
"sort defensively" makes the function correct for any caller but duplicates a
guarantee and quietly re-sorts data someone may have deliberately ordered
another way. Pick one, write the test that pins it, and put the reason in the
JSDoc. A test that does not correspond to a stated contract is a test that gets
deleted the first time it goes red.

**Why this approach?** No `beforeEach`, no database reset, no server on a port.
Four tests over plain arrays, with nothing to set up or tear down. That is what
Phase 2 bought.

### Step 3.3: Quiz yourself

1. `expect(result[0].events).toBeFalsy()` passes when `events` is `undefined`
   _and_ when it is `[]`... actually, does it? Work out what `toBeFalsy` does
   with `[]`, then explain why that matters for this specific test.
2. Why does the mutation test need a matcher that compares identity rather than
   contents? What bug slips through if you only compare contents?
3. You skipped an HTTP-level test of `GET /tasks`. Name one real bug this pure
   test suite cannot catch, and say whether that is acceptable here.
4. `computeBlockedState` mutates its input. If you wrote these same four tests
   against it, which one becomes impossible to write?

### ✅ Solution

```ts
describe('attachEvents', () => {
  it('groups events onto the task they belong to', () => {
    const tasks = [task('a'), task('b')]; // → Task[]
    const rows = [
      row('e1', 'a', '2026-08-21T06:00:00.000Z'),
      row('e2', 'a', '2026-08-21T06:00:01.000Z'),
      row('e3', 'b', '2026-08-21T06:00:02.000Z'),
    ];
    const result = attachEvents(tasks, rows); // → Task[]

    expect(result[0].events).toHaveLength(2);
    expect(result[1].events).toHaveLength(1);
    expect(result[1].events?.[0].id).toBe('e3');
  });

  it('gives a task with no events an empty array, not undefined', () => {
    const result = attachEvents([task('lonely')], []); // → Task[]
    expect(result[0].events).toEqual([]); // fails on undefined
  });

  it('preserves the order the rows arrived in', () => {
    const rows = [
      row('late', 'a', '2026-08-21T09:00:00.000Z'),
      row('early', 'a', '2026-08-21T06:00:00.000Z'),
    ];
    const result = attachEvents([task('a')], rows); // → Task[]
    // Contract: the caller sorts (see the .orderBy in GET /tasks).
    // attachEvents preserves whatever order it was handed.
    expect(result[0].events?.map((e) => e.id)).toEqual(['late', 'early']);
  });

  it('does not mutate the tasks it was given', () => {
    const original = task('a'); // → Task
    const result = attachEvents([original], [row('e1', 'a', '')]);
    expect(original.events).toBeUndefined();
    expect(result[0]).not.toBe(original); // identity, not contents
  });
});
```

Quiz answers: (1) No - `[]` is **truthy** in JavaScript, so `toBeFalsy()` would
_fail_ on the correct value and pass on the buggy one. It is exactly backwards,
which is why `toEqual([])` is the assertion. (2) `toEqual` compares structure,
so a mutated original and a fresh copy both "equal" the same thing; only
`not.toBe` proves two different objects. Without it, an implementation that did
`task.events = [...]` and returned the same objects would pass. (3) It cannot
catch a wiring bug - wrong column in the `where`, forgotten `orderBy`, the
route calling `attachEvents` with arguments swapped. Acceptable here because
the route body is now four lines - two query clauses and one function call -
and the HTTP test is offered as a stretch goal. (4) The mutation test. You cannot assert "did not
mutate" against a function whose contract is to mutate.

### Step 3.4: Run it

```bash
bunx vitest run src/lib/attachEvents.test.ts
bunx vitest run
```

**Expected output**: 4 passed in the first, `Test Files 8 passed (8)` and
`Tests 137 passed (137)` in the second.

**If it fails**: `Cannot find module './attachEvents'` means the test is not
beside the module - both belong in `src/lib/`. If the empty-array test fails
with `undefined`, your Phase 2 implementation is missing the `?? []`; that is
the test doing its job, go fix the source rather than the assertion. Type errors
on the `row()` fixture mean the literal does not satisfy `HookEventRow` - check
`completedAt: null` rather than `undefined`, since the column is nullable.

### ✅ Phase 3 complete

**You have learned**: extraction beats dependency injection when the function
does not truly need I/O; a fallback branch needs a test that exercises the
fallback; `[]` is truthy, and truthiness assertions on collections invert.

**Next**: nothing. Run the test plan, tick the criteria, close ETH-17.

---

## Test plan

Runnable start to finish, including setup and teardown.

1. **Baseline before any edit.**

   ```bash
   bunx vitest run          # → 133 passed
   bunx tsc --noEmit        # → exit 0
   bun run lint             # → exit 0, 6 warnings
   ```

2. **Confirm the fixture data exists.** These commands are the ground truth
   the rest of the plan checks against.

   ```bash
   sqlite3 data/dashboard.db "select count(*) from hook_events"
   # → non-zero. If 0, no hook has ever fired successfully; run any tool in a
   #   Claude Code session with `bun run dev` up, then re-check.

   sqlite3 data/dashboard.db \
     "select task_id, count(*) from hook_events group by task_id"
   # → at least one task with 2+ events, so grouping has something to group.
   ```

3. **Unit tests** (after Phase 3):

   ```bash
   bunx vitest run          # → 137 passed, 8 files
   ```

4. **End to end.** Start the API alone - no Vite needed, and the bare route is
   what hooks and curl use:

   ```bash
   bun run src/server.ts &
   SERVER_PID=$!
   sleep 2
   ```

   List route, checking events are present and ascending:

   ```bash
   curl -s localhost:3001/tasks \
     | python3 -c 'import json,sys; ts=[e["timestamp"] for t in json.load(sys.stdin) for e in t["events"]]; print("ascending:", ts==sorted(ts), len(ts), "events")'
   # → ascending: True <n> events
   ```

   Single-task route, checking parity with the list route:

   ```bash
   ID=$(sqlite3 data/dashboard.db "select task_id from hook_events limit 1")
   curl -s "localhost:3001/tasks/$ID" | python3 -m json.tool | head -20
   # → an object with an "events" array. Before this plan: no events key.
   ```

   Teardown:

   ```bash
   kill $SERVER_PID
   ```

5. **In the browser** (optional but it is the actual user-facing check):
   `bun run dev`, open <http://localhost:5173>, expand a task that has events.
   The Event Trail lists tool calls oldest at the top, and the `N/M done`
   counter in its header matches the row count. Stop with Ctrl-C.

**If a step fails**, do not proceed to the next phase. The phases are ordered so
each one's failure is diagnosable on its own.

---

## Done criteria

Every box is a command with a visible result.

### Per phase

- [ ] **Phase 1** - `grep -n "orderBy(asc(hookEventsTable.timeStamp))" src/server.ts`
      returns at least one match
- [ ] **Phase 2a** - `test -f src/lib/attachEvents.ts && grep -c "export const" src/lib/attachEvents.ts`
      prints `2`
- [ ] **Phase 2b** - `grep -c "attachEvents(" src/server.ts` prints `2` (both
      routes call it)
- [ ] **Phase 2c** - `grep -n "const toHookEvent" src/server.ts` returns
      nothing (it moved)
- [ ] **Phase 3** - `bunx vitest run src/lib/attachEvents.test.ts` → 4 passed
- [ ] **End to end** - `curl -s "localhost:3001/tasks/$(sqlite3 data/dashboard.db 'select task_id from hook_events limit 1')" | grep -c events`
      prints `1`

### Final gates

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun run lint` exits 0 with no new warnings (6 pre-existing)
- [ ] `bunx vitest run` → 137 passed, 8 files
- [ ] `git status --short` shows only `src/server.ts`,
      `src/lib/attachEvents.ts`, `src/lib/attachEvents.test.ts`,
      `plans/README.md`
- [ ] `bunx rumdl check plans/004-attach-events-deterministically.md` reports
      exactly 4 MD013 line-length issues and nothing else. Those four are
      deliberate and must not be wrapped: one `python3` one-liner in the test
      plan and the three stretch-goal prompts, all of which have to stay on a
      single line to stay copy-pasteable.
- [ ] `plans/README.md` has a row for plan 004
- [ ] ETH-17 closed in Linear, with a comment naming commit `211e5e4` as where
      the original attach landed, and the GitHub mirror closed to match

---

## STOP conditions

Stop and report back. Do not improvise if:

- **Drift.** Any excerpt in "Current state" does not match the live code. The
  line numbers are from commit `2e4fe1d`.
- **The symptom does not change.** After Phase 2, `GET /tasks/:id` still
  returns no `events` key. That means something other than the route shapes the
  response, and guessing at it will make the diff worse than the bug.
- **`hook_events` is empty.** `select count(*)` returns 0. The pipeline that
  fills it is upstream of this plan (ETH-15, the health check). You cannot
  verify ordering with nothing to order. Report it rather than writing rows by
  hand - fabricated fixtures would hide whichever upstream break caused the
  zero.
- **The test suite goes from 133 to fewer than 133.** You broke something that
  was passing. Read the failure before adding anything else.
- **`tsc` reports errors inside `src/db/schema.ts` or `drizzle-orm`.** That is
  a dependency or migration problem, not this plan. Report the exact error.

---

## Maintenance notes

- The `.orderBy(asc(...))` clause is now written twice, once per route. Two is
  a coincidence, three is a pattern. **If a third route needs a task's events,
  extract a `selectEventsFor(ids: string[])` query helper** rather than pasting
  the chain again. Not before - a helper that wraps one four-line chain for two
  callers costs more to read than it saves.
- No index on `hook_events(task_id)` was added. `inArray` currently scans the
  table, which is free at 42 rows and stays fine into the low thousands. Add
  one when a `GET /tasks` p95 crosses roughly 50ms, and measure before and
  after - not because the index is doubtful, but because an unmeasured index is
  an unfalsifiable claim. The `ORDER BY` from Phase 1 is what makes adding it
  safe, so this plan is the prerequisite.
- **A reviewer should check three things.** That `attachEvents` imports nothing
  that opens a connection - `src/db/schema.ts` is fine, `src/db/index.ts` is
  not. That the empty-array test asserts `toEqual([])` and not a truthiness
  matcher. And that `GET /tasks/:id` runs its row through `toTask()`, matching
  the list route.
- **`GET /tasks/pool` was deliberately left without events.** Documented in
  Scope. If a future consumer needs them there, it is a three-line change plus
  a decision about the extra query per poll.
- `attachEvents` does not sort. That contract is stated in its JSDoc and pinned
  by a test. If a caller ever passes unsorted rows and gets a scrambled trail,
  the bug is in the caller, and the JSDoc is what tells the next person that.

---

## What you should know now

### You can now do, unaided

- Date any line of code to the commit that introduced it, even when the commit
  message never mentions the feature, using `git log -S`.
- Look at a function and sort it into Data, Calculation, or Action in three
  questions, then say what that classification costs you at test time.
- Recognize when a pure function is untestable _by association_ - because of
  what its file imports - and move it rather than mocking around it.
- Decide whether a `SELECT` needs an `ORDER BY` by asking what the consumer
  does with the sequence, not by looking at whether the output currently seems
  right.
- Write a test that protects a fallback branch, and spot the truthiness
  assertions that silently invert on empty collections.
- Judge when _not_ to extract a function, using "is something asking for it"
  instead of "is it pure".

### Now true about this codebase

- `GET /tasks` and `GET /tasks/:id` return the same shape, through one shared
  function, in one place to change.
- `src/db/index.ts:5` opens the database as an **import-time** side effect.
  Anything that imports `src/server.ts` boots the backend. That is the
  constraint that decides where pure helpers live.
- `casing: 'snake_case'` at `src/db/index.ts:13` is the only translation
  between the schema's `timeStamp` and SQLite's `time_stamp`. You write the
  TypeScript name; Drizzle emits the SQL name.
- ETH-17's attach landed in `211e5e4` on 2026-08-21, not in a commit named
  after it. The ticket was filed 2026-08-19 and is still open.
- `src/lib/` is where Calculations go, each with a test beside it. `src/server.ts`
  is where Actions go. That split is now load-bearing, not stylistic.

### Check yourself

1. A new endpoint next month returns tasks with events and someone reports the
   trail is backwards. You have three files open. What is your first grep, and
   what are the two candidate causes it distinguishes between?
2. Someone proposes adding `attachLogs(tasks, rows)` for the `logs` table,
   shaped identically. Do you write a second function, or generalize
   `attachEvents` into a `groupBy` that both use? Name the specific condition
   that decides it.
3. A teammate says "just mock the database in the test and keep `attachEvents`
   in `server.ts`". Give the one-sentence reason that does not work here, citing
   a file and line.

---

## Stretch goals

**HTTP-level route test** - Phase 3 tests the Calculation, so a wiring bug (the
wrong column in a `where`, a forgotten `orderBy`, arguments passed in the wrong
order) still ships silently. The route body is small enough that this is a real
gap rather than a theoretical one.

> Copy this prompt to get a tutorial for it:
> `In /Users/ea/Programming/web/fractal/claude-agent-dashboard, src/server.ts exports a Hono app whose routes are currently untested at the HTTP level - there is no server test file, and importing src/server.ts opens the real SQLite database because src/db/index.ts:5 calls new Database('data/dashboard.db') at module scope. Write me a hands-on tutorial that adds HTTP-level tests for GET /tasks and GET /tasks/:id using Hono's app.request() helper, solving the import-time-database problem first. Teach the options (inject the db client as a Hono context variable, use an in-memory SQLite database for tests, or restructure src/db/index.ts to export a factory) and have me choose with the trade-offs explained. Vitest with jsdom is the existing runner; the suite is currently 137 tests across 8 files. Follow the plans/004 format: status block, current state with real line numbers, concept-then-stub-then-quiz-then-solution phases, and machine-checkable done criteria.`

**Index the foreign key, with a measurement** - `hook_events(task_id)` has no
index, so every `GET /tasks` scans the table. Free today at 42 rows. The
interesting part is not adding the index, it is building the measurement that
proves it was needed.

> Copy this prompt to get a tutorial for it:
> `In /Users/ea/Programming/web/fractal/claude-agent-dashboard, the hook_events table (src/db/schema.ts) has a task_id foreign key with no index, and GET /tasks in src/server.ts queries it with inArray plus orderBy on time_stamp. Migrations are managed by drizzle-kit. Write me a tutorial that teaches me to (1) generate synthetic load - tens of thousands of hook_events rows - (2) measure the query with EXPLAIN QUERY PLAN and wall-clock timing before any change, (3) add a drizzle migration for the right index, choosing between a single-column index on task_id and a composite on (task_id, time_stamp) and explaining which the query planner can use for both the filter and the sort, and (4) measure again. Teach me to read EXPLAIN QUERY PLAN output line by line. Follow the plans/004 format with concept-then-stub-then-quiz-then-solution phases.`

**Retire the polling loop for a stream** - `useTaskPolling` refetches every task
and every event every 2.5 seconds regardless of whether anything changed. At 42
events that is invisible; at 4,000 it is a full table read six times a minute,
and the Event Trail still lags up to 2.5s behind the agent.

> Copy this prompt to get a tutorial for it:
> `In /Users/ea/Programming/web/fractal/claude-agent-dashboard, src/hooks/useTaskPolling.ts refetches GET /api/tasks and GET /api/sessionEvents on a 2500ms setInterval, and hook scripts in scripts/ write to the Hono API in src/server.ts. Write me a tutorial that replaces polling with Server-Sent Events: add a GET /events SSE endpoint to the Hono server that pushes on write, and replace the interval in useTaskPolling with an EventSource consumer that keeps the same UseTaskPollingResult return shape so Dashboard.tsx and TaskTable.tsx need no changes. Teach why SSE fits here rather than WebSockets (one-way, text, auto-reconnect), how the Vite proxy in vite.config.ts must be configured for a streaming response, and how to keep the polling path as a fallback when EventSource fails. Follow the plans/004 format with concept-then-stub-then-quiz-then-solution phases and machine-checkable done criteria.`

---

## Advanced techniques and alternate solutions

The Phase 2 solution is one of several. Each of these is right somewhere.

### A single SQL `LEFT JOIN` instead of two queries

Let the database do the join and hand back one flat result set.

```sql
SELECT t.*, he.id AS event_id, he.tool_name, he.time_stamp
FROM tasks t
LEFT JOIN hook_events he ON he.task_id = t.id
ORDER BY t.id, he.time_stamp;
```

**Pick this when** the events set is large enough that a second round trip
costs real time, or when you need database-level filtering across both tables
("tasks whose last event failed"). **Not here**, and the reason is worth
knowing: a `LEFT JOIN` returns one row per event, so a task with 40 events
repeats all of its own columns 40 times over the wire, and you still write the
grouping loop - just against a flatter, uglier row shape. Two queries plus a
`Map` moves less data and produces the exact structure the client wants. The
crossover is round-trip latency: over a network with real per-query cost, or
when the query count grows with the result set, the join wins.

### Drizzle's relational query API (`db.query.tasks.findMany({ with: ... })`)

Drizzle can build the nesting for you, if the schema declares relations.

```ts
const tasks = await db.query.tasks.findMany({
  with: { events: { orderBy: asc(hookEventsTable.timeStamp) } },
});
```

**Pick this when** you have three or more of these attach-a-child-collection
sites. It removes the hand-written grouping entirely and the nesting is
declared once, in the schema, instead of re-derived per route. **Not here**
because `src/db/schema.ts` declares no `relations()` at all - adopting this
means adding relation declarations for every table, which is a schema-wide
change to solve a two-route problem. Worth revisiting the moment a third
collection needs attaching. This is the alternate that is _worse here but
better in most codebases_: at eight endpoints, the hand-written `Map` in eight
places is the thing you regret.

### Sorting in JavaScript instead of `ORDER BY`

```ts
rows.sort((a, b) => (a.timeStamp ?? '').localeCompare(b.timeStamp ?? ''));
```

**Pick this when** the ordering is a display concern that varies per caller -
the user clicks a column header - or when you must sort by something SQL cannot
express cheaply. **Not here**: the chronological order is not a preference, it
is what the data means, so it belongs to the query. Considered and rejected
while writing Phase 1 for the reason in that phase's "Why this approach?".

### A generic `groupBy` helper

```ts
const groupBy = <T, K>(items: T[], key: (item: T) => K): Map<K, T[]> => { ... };
```

**Pick this when** three or more places group a flat list into buckets. **Not
here**: one call site does not justify a generic, and the specific version
carries information the generic cannot - its name says what it produces, its
types say `Task[]` in and `Task[]` out, and its JSDoc states the
caller-sorts contract. If `attachLogs` ever lands, that is the second call site;
extract at the third.

---

## Reference

### Full reference implementation

**`src/lib/attachEvents.ts`** (new, complete):

```ts
// ─── IMPORTS ──────────────────────────────────────────────────────────────
import type { hookEventsTable } from '../db/schema';
import type { HookEvent, Task } from '../types/task';

// ─── DATA ─────────────────────────────────────────────────────────────────

type HookEventRow = typeof hookEventsTable.$inferSelect;

// ─── CALCULATION ──────────────────────────────────────────────────────────

/**
 * Convert a stored hook_events row into the HookEvent shape the frontend expects.
 * Storage allows nulls and names the column `timeStamp`; the domain type does not.
 */
export const toHookEvent = (row: HookEventRow): HookEvent => ({
  id: row.id,
  toolName: row.toolName ?? 'unknown',
  phase: (row.phase ?? 'pre') as HookEvent['phase'],
  status: row.status as HookEvent['status'],
  summary: row.summary ?? '',
  timestamp: row.timeStamp ?? '',
  completedAt: row.completedAt ?? undefined,
});

/**
 * Attach each task's hook events, grouped by task id.
 *
 * Does not sort. Callers order the rows in the query so the guarantee lives in
 * one place; see the `.orderBy` in `GET /tasks`.
 *
 * @param tasks - tasks in the order they should be returned
 * @param rows - hook_events rows for those tasks, already sorted by the caller
 * @returns the same tasks, same order, each with an `events` array (never undefined)
 */
export const attachEvents = (tasks: Task[], rows: HookEventRow[]): Task[] => {
  const eventsByTaskId = new Map<string, HookEvent[]>();
  for (const row of rows) {
    const bucket = eventsByTaskId.get(row.taskId) ?? [];
    bucket.push(toHookEvent(row));
    eventsByTaskId.set(row.taskId, bucket);
  }

  return tasks.map((task) => ({
    ...task,
    events: eventsByTaskId.get(task.id) ?? [],
  }));
};
```

**`src/server.ts`**, `GET /tasks` tail:

```ts
const ids = tasks.map((task) => task.id);

const hookEventRows = await db
  .select()
  .from(hookEventsTable)
  .where(inArray(hookEventsTable.taskId, ids))
  .orderBy(asc(hookEventsTable.timeStamp));

return c.json(attachEvents(tasks, hookEventRows));
```

**`src/server.ts`**, `GET /tasks/:id` tail:

```ts
const eventRows = await db
  .select()
  .from(hookEventsTable)
  .where(eq(hookEventsTable.taskId, id))
  .orderBy(asc(hookEventsTable.timeStamp));

const [task] = attachEvents([toTask(rows[0])], eventRows);
return c.json(task);
```

**`src/lib/attachEvents.test.ts`**: see the Phase 3 solution above, complete as
written.

### Common patterns

| Pattern                     | Shape                                                  | Where it appears here   |
| --------------------------- | ------------------------------------------------------ | ----------------------- |
| Group-then-attach           | `Map<K, V[]>` built in one pass, one `.get` per parent | `attachEvents`          |
| Storage-to-domain converter | `(row) => Domain`, nullables collapsed with `??`       | `toHookEvent`, `toTask` |
| Guarantee in the query      | `.orderBy()` rather than a later `.sort()`             | both routes             |
| Leaf module                 | pure functions, no import that opens a connection      | `src/lib/*`             |
| Test beside the module      | `foo.ts` / `foo.test.ts` in the same directory         | all of `src/lib/`       |

### Troubleshooting

**Problem:** `curl localhost:3001/api/tasks` returns 404.
**Solution:** `/api` is a Vite dev-proxy prefix only (`vite.config.ts`). The
Hono server registers the bare route. Browser code uses `/api/tasks`; curl,
hooks, and scripts use `/tasks`. This is the same bug class as ETH-15.

**Problem:** `no such column: taskId`.
**Solution:** you passed the TypeScript property name into raw SQL. Drizzle
translates `taskId` to `task_id` via `casing: 'snake_case'`; hand-written SQL
gets no translation. Use `task_id` in `sqlite3`, `taskId` in Drizzle.

**Problem:** the test file opens `data/dashboard.db` or hangs.
**Solution:** something in its import graph reaches `src/db/index.ts`. Import
only `src/db/schema.ts` for the row type. `schema.ts` declares tables, it does
not connect.

**Problem:** `events` present in `GET /tasks` but not in the UI.
**Solution:** check `useTaskPolling.ts:72` still spreads with `{ ...t }` and
`buildTree` still spreads at line 26. Both are shallow copies that preserve
unknown keys; a `.map()` that constructs explicit objects would drop `events`
silently.

**Problem:** the empty-array test passes even after you delete the `?? []`.
**Solution:** your assertion is a truthiness check. `[]` is truthy and
`undefined` is falsy, so `toBeFalsy` and `toBeTruthy` both test the opposite of
what you meant. Use `toEqual([])`.

### Key takeaways

1. **Row order is a request, not a property.** `SELECT` returns a bag. If the
   consumer reads the sequence as meaning, the query says `ORDER BY`.
2. **ISO-8601 is shaped so a text sort is a time sort.** Fixed-width,
   zero-padded, largest unit first. The format was designed for exactly that.
3. **Pure functions can be untestable by association.** What a file imports
   decides what a test must boot. Move the function; do not mock the neighbor.
4. **Extraction beats dependency injection when you have the choice.** DI makes
   an Action testable. Extraction makes it stop being an Action.
5. **Extract when something asks.** A second caller or a test. "It is pure" is
   not a reason on its own, and `toTask` staying put is the proof.
6. **Test the branch that is easy to delete.** The happy path defends itself.
   The `?? []` fallback does not.
7. **A ticket's status is a claim; `git log -S` is evidence.** ETH-17's code
   shipped 2026-08-21 and the ticket is still open.

---

**End of Tutorial**
