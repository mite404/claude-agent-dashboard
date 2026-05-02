# Tutorial: Adding a Column to the Kanban Board

This tutorial walks through two things at once:

1. A real TypeScript error pattern you'll encounter when extending this codebase
2. How to add the missing **Paused** column to `KanbanBoard.tsx`

By the end, you'll have a working sixth column and a mental model for what
`Record<TaskStatus, T>` means and why TypeScript enforces it.

---

## Part 1 — The TypeScript Error Pattern

### What is `Record<K, V>`?

`Record<K, V>` is TypeScript shorthand for "an object where every key from union `K`
maps to a value of type `V`." Think of it like a lookup table with a strict guest list.
Every member of the union **must** have an entry — TypeScript will refuse to compile
if even one is missing.

```typescript
type TaskStatus = 'running' | 'paused' | 'completed';

// This compiles — all three keys present
const STATUS_LABEL: Record<TaskStatus, string> = {
  running:   'Running',
  paused:    'Paused',
  completed: 'Done',
};
```

### What breaks when you add a new status?

Imagine you add `'unassigned'` to `TaskStatus` but forget to update `STATUS_LABEL`:

```typescript
// Updated union
type TaskStatus = 'running' | 'paused' | 'completed' | 'unassigned';

// STATUS_LABEL is now BROKEN — TypeScript error:
// Property 'unassigned' is missing in type '{ running: string; paused: string;
// completed: string; }' but required in type 'Record<TaskStatus, string>'
const STATUS_LABEL: Record<TaskStatus, string> = {
  running:   'Running',
  paused:    'Paused',
  completed: 'Done',
  // ← 'unassigned' missing here
};
```

At runtime, calling `STATUS_LABEL['unassigned']` would silently return `undefined`
instead of a label string. You'd see blank badges, missing icons, or broken UI with
no obvious error message. TypeScript catches this at build time instead.

### Where this pattern lives in the codebase

Every `Record<TaskStatus, ...>` in `src/lib/taskConfig.tsx` enforces this rule:

| Constant | What it powers |
|---|---|
| `STATUS_LABEL` | Badge display name |
| `STATUS_ICON` | Icon next to status |
| `STATUS_TEXT` | Text color class |
| `STATUS_ORDER` | Sort priority in the table |
| `PROGRESS_BAR` | Progress bar color |
| `CHECKPOINT_ICON` | Symbol in the subtask list |
| `CHECKPOINT_COLOR` | Color of that symbol |

And `src/components/ui/badge.tsx` has two more:

| Constant | What it powers |
|---|---|
| `badgeVariants` (the `variant` key) | Badge background/border/text |
| `statusDot` | The colored dot inside the badge |

When `'unassigned'` and `'claimed'` were added to the `TaskStatus` union but not
to these eight objects, there were eight TypeScript errors blocking `bun run build`.
The fix was mechanical: add the missing keys with appropriate values to each object.

---

## Part 2 — Adding the Paused Column

The `KanbanBoard.tsx` component is built around a `COLUMNS` config array.
Each entry describes one column: which statuses belong to it, what status gets
written when a card is dropped into it, and whether it's a terminal or read-only lane.

The **Paused** column was left out intentionally so you can add it. Here's everything
you need.

### Step 1 — Understand the `ColumnConfig` type

Open `src/components/KanbanBoard.tsx` and find this interface:

```typescript
interface ColumnConfig {
  id:          string;       // used as the droppable zone ID
  label:       string;       // column header text
  statuses:    TaskStatus[]; // which task statuses appear here
  dropStatus:  TaskStatus;   // status written when a card is dropped here
  readonly?:   boolean;      // can't be dragged into (computed status)
  terminal?:   boolean;      // can't be dragged out (completed/cancelled)
  showNewCard?: boolean;     // shows the + card at the bottom
}
```

### Step 2 — Understand the transition rules

Also in `KanbanBoard.tsx`, find `VALID_TRANSITIONS`. This is where the board decides
which moves are legal when a card is dragged between columns:

```typescript
const VALID_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  unassigned: ['claimed', 'cancelled'],
  claimed:    ['running', 'unassigned', 'cancelled'],
  running:    ['completed', 'cancelled'],
  blocked:    ['running', 'cancelled'],
};
```

Notice `'paused'` is not here yet — cards with `status: 'paused'` can't be dragged
anywhere. You need to add its valid moves.

A paused task can be:

- Resumed → `'running'`
- Abandoned → `'cancelled'`

### Step 3 — Your code to write

You need to make **three small changes** to `src/components/KanbanBoard.tsx`:

**Change A — Add the transition rule (inside `VALID_TRANSITIONS`):**

```typescript
paused: ['running', 'cancelled'],
```

**Change B — Add the column config (inside `COLUMNS`, between `blocked` and `done`):**

```typescript
{
  id:         'paused',
  label:      'Paused',
  statuses:   ['paused'],
  dropStatus: 'paused',
},
```

**Change C — Allow `running` tasks to be dragged to Paused** (update the `running` entry
in `VALID_TRANSITIONS`):

```typescript
// before
running: ['completed', 'cancelled'],

// after
running: ['paused', 'completed', 'cancelled'],
```

That's it. Three additions, under 10 lines total. Once you save the file, the Paused
column will appear between Blocked and Done in the board, and running tasks can be
dragged into it.

### Step 4 — Verify

1. Open the board in your browser (`bun run dev` → `http://localhost:5173`).
2. You should see six columns: Unassigned → Claimed → Running → Blocked → Paused → Done.
3. Create a test task in Unassigned via the `+` card.
4. Drag it through: Unassigned → Claimed → Running → Paused → Running → Done.
5. Try dragging a Paused card into Blocked — the board should reject it with a toast.
6. Run `bunx tsc --noEmit` to confirm zero TypeScript errors.

---

## What You Just Learned

- `Record<K, V>` requires exhaustive coverage of every union member in `K`.
- Adding a value to a TypeScript union (`|`) creates a "debt" — every `Record` using
  that union needs to be updated. TypeScript tells you exactly which ones.
- The `COLUMNS` array in `KanbanBoard.tsx` is the single place that defines what
  columns exist and what status each column represents. Adding a column is pure
  data — no new component, no new handler, just a config entry.
- `VALID_TRANSITIONS` is a separate concern from `COLUMNS`. A column can exist without
  any transitions (like Blocked, which is read-only). A transition can reference a
  column's `dropStatus` to say "this move is allowed."
