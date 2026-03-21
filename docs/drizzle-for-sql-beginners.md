# Drizzle for SQL Beginners

You know TypeScript. You know databases exist. But SQL syntax and Drizzle operators feel
like a foreign language. This guide bridges that gap.

## Mental Model: SQL is Just Questions

SQL at its core is asking the database questions:

- "Give me all tasks" → `SELECT * FROM tasks`
- "Give me tasks with status = 'running'" → `SELECT * FROM tasks WHERE status = 'running'`
- "Insert a new task" → `INSERT INTO tasks (name, status) VALUES ('Build feature', 'running')`

Drizzle is a **TypeScript wrapper** that builds these questions for you, so you don't
have to write raw SQL strings.

## Part 1: WHERE Clauses — Filtering Data

### The SQL Version

```sql
SELECT * FROM tasks WHERE status = 'running';
```

This says: "Give me all tasks WHERE the status column equals 'running'."

You can combine multiple conditions:

```sql
SELECT * FROM tasks
WHERE status = 'running' AND sessionId = 'sess-123';
```

This says: "Give me tasks where BOTH conditions are true: status is 'running' AND sessionId is 'sess-123'."

### The Drizzle Version

Drizzle has operators that do the same thing:

```typescript
import { eq, and } from 'drizzle-orm'

// Single condition
const rows = await db
  .select()
  .from(tasksTable)
  .where(eq(tasksTable.status, 'running'))

// Multiple conditions
const rows = await db
  .select()
  .from(tasksTable)
  .where(and(
    eq(tasksTable.status, 'running'),
    eq(tasksTable.sessionId, 'sess-123')
  ))
```

**Translation:**

- `eq(column, value)` = `column = value` in SQL
- `and(condition1, condition2)` = `condition1 AND condition2` in SQL

### Common Comparison Operators

| Drizzle | SQL | Meaning |
|---------|-----|---------|
| `eq(col, val)` | `col = val` | Equals |
| `ne(col, val)` | `col != val` | Not equals |
| `gt(col, val)` | `col > val` | Greater than |
| `gte(col, val)` | `col >= val` | Greater than or equal |
| `lt(col, val)` | `col < val` | Less than |
| `lte(col, val)` | `col <= val` | Less than or equal |
| `like(col, val)` | `col LIKE val` | Pattern match (% wildcards) |
| `inArray(col, [vals])` | `col IN (vals)` | Column is in this list |

### Combining Conditions: AND vs. OR

**AND** — all conditions must be true:

```typescript
// SQL: WHERE status = 'running' AND priority = 'high'
where(and(
  eq(tasksTable.status, 'running'),
  eq(tasksTable.priority, 'high')
))
```

**OR** — any condition can be true:

```typescript
// SQL: WHERE status = 'running' OR status = 'paused'
where(or(
  eq(tasksTable.status, 'running'),
  eq(tasksTable.status, 'paused')
))
```

## Part 2: Handling Optional Filters

In your API, query params might not always be provided:

```
GET /api/tasks?status=running           ← status provided
GET /api/tasks                          ← no params at all
GET /api/tasks?sessionId=sess-123       ← only sessionId provided
```

**The problem:** You can't use `eq()` with `undefined`:

```typescript
const status = c.req.query('status')  // Could be undefined!
eq(tasksTable.status, status)         // ❌ Error: status might be undefined
```

**The solution:** Check if the param exists before building the condition:

```typescript
const status = c.req.query('status');
const sessionId = c.req.query('sessionId');

const conditions = [];
if (status) conditions.push(eq(tasksTable.status, status));
if (sessionId) conditions.push(eq(tasksTable.sessionId, sessionId));

const rows = await db
  .select()
  .from(tasksTable)
  .where(conditions.length > 0 ? and(...conditions) : undefined);
```

**What this does:**

- Build a `conditions` array
- Only add a condition if the param exists
- If no conditions, `where(undefined)` means "no filter" (return all rows)
- If conditions exist, combine them with `and()`

**Alternative:** Require the params upfront and return an error if missing:

```typescript
const status = c.req.query('status');
const sessionId = c.req.query('sessionId');

if (!status || !sessionId) {
  return c.json({ error: 'status and sessionId are required' }, 400);
}

// Now both are guaranteed to be strings
const rows = await db
  .select()
  .from(tasksTable)
  .where(and(
    eq(tasksTable.status, status),
    eq(tasksTable.sessionId, sessionId)
  ));
```

**When to use which:**

- **Optional filtering** — API accepts partial params (flexible queries)
- **Required params** — API needs specific data to work (early validation)

For your dashboard, required params often make sense: a user needs to specify which
session's tasks they want.

## Part 3: INSERT — Adding Data

### The SQL Version

```sql
INSERT INTO tasks (name, status, sessionId)
VALUES ('Build feature', 'running', 'sess-123');
```

### The Drizzle Version

```typescript
const result = await db.insert(tasksTable).values({
  name: 'Build feature',
  status: 'running',
  sessionId: 'sess-123',
});
```

**Key difference:** Drizzle uses an object, not a string. The keys match your schema column names.

### Handling Request Body

```typescript
app.post('/tasks', async (c) => {
  const body = await c.req.json();

  // Validate required fields
  if (!body.name || !body.sessionId) {
    return c.json({ error: 'name and sessionId required' }, 400);
  }

  // Insert
  const result = await db.insert(tasksTable).values({
    id: crypto.randomUUID(),  // Generate ID if needed
    name: body.name,
    sessionId: body.sessionId,
    status: body.status || 'unassigned',  // Use default if not provided
  });

  return c.json({ id: result.lastInsertRowid }, 201);
});
```

## Part 4: UPDATE — Modifying Data

### The SQL Version

```sql
UPDATE tasks
SET status = 'completed'
WHERE id = 'task-123';
```

### The Drizzle Version

```typescript
const result = await db
  .update(tasksTable)
  .set({ status: 'completed' })
  .where(eq(tasksTable.id, 'task-123'));
```

**Pattern:**

1. `.update(table)` — which table?
2. `.set(changes)` — what fields to change?
3. `.where(condition)` — which rows?

### Example: Toggle Task Status

```typescript
app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  if (!id) {
    return c.json({ error: 'id required' }, 400);
  }

  const result = await db
    .update(tasksTable)
    .set({ status: body.status })
    .where(eq(tasksTable.id, id));

  return c.json({ updated: result.changes > 0 });
});
```

## Part 5: DELETE — Removing Data

### The SQL Version

```sql
DELETE FROM tasks WHERE id = 'task-123';
```

### The Drizzle Version

```typescript
const result = await db
  .delete(tasksTable)
  .where(eq(tasksTable.id, 'task-123'));
```

## Part 6: Your Dashboard Schema in Action

Here's how these patterns apply to your actual tables:

### Example 1: Get all tasks for a session

```typescript
// SQL:
// SELECT * FROM tasks WHERE sessionId = 'sess-123';

const sessionId = 'sess-123';
const tasks = await db
  .select()
  .from(tasksTable)
  .where(eq(tasksTable.sessionId, sessionId));
```

### Example 2: Get running tasks that aren't blocked

```typescript
// SQL:
// SELECT * FROM tasks
// WHERE sessionId = 'sess-123'
// AND status = 'running'
// AND status != 'blocked';

const tasks = await db
  .select()
  .from(tasksTable)
  .where(and(
    eq(tasksTable.sessionId, 'sess-123'),
    eq(tasksTable.status, 'running'),
    ne(tasksTable.status, 'blocked')
  ));
```

### Example 3: Get session events for a specific session

```typescript
// SQL:
// SELECT * FROM session_events WHERE sessionId = 'sess-123';

const events = await db
  .select()
  .from(sessionEventsTable)
  .where(eq(sessionEventsTable.sessionId, 'sess-123'));
```

### Example 4: Create a new task

```typescript
const newTask = await db.insert(tasksTable).values({
  id: crypto.randomUUID(),
  name: 'New task',
  sessionId: 'sess-123',
  status: 'unassigned',
  createdAt: new Date().toISOString(),
});
```

### Example 5: Mark a task as completed

```typescript
const updated = await db
  .update(tasksTable)
  .set({
    status: 'completed',
    completedAt: new Date().toISOString(),
  })
  .where(eq(tasksTable.id, taskId));
```

## Key Takeaways

1. **SQL is questions, Drizzle is TypeScript wrappers for those questions**
2. **`where(eq(...))` = `WHERE column = value` in SQL**
3. **`and()` and `or()` combine conditions like `AND` and `OR` in SQL**
4. **Always validate params before using them in queries** (check for `undefined`)
5. **Use `.set()` for updates, `.values()` for inserts**
6. **The WHERE clause is your filter — use it to target exactly which rows you want**

## Further Reading

## Further Reading

- [Drizzle Docs: Select](https://orm.drizzle.team/docs/select) — reading data
- [Drizzle Docs: Insert](https://orm.drizzle.team/docs/insert) — creating data
- [Drizzle Docs: Update](https://orm.drizzle.team/docs/update) — modifying data
- [Drizzle Docs: Delete](https://orm.drizzle.team/docs/delete) — removing data
- [SQL Tutorial](https://www.w3schools.com/sql/) — if you want the SQL fundamentals first
