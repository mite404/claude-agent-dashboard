# TaskTable Feature Expansion — Implementation Tutorial

> **Learning Goal:** Build a complete understanding of multi-column sorting, column visibility toggling, bulk actions, and terminal spawning by implementing each feature from scratch. This tutorial is designed to teach you *how* to think about state management and component composition, not just copy-paste code.

---

## Table of Contents
1. [Prerequisites & Mental Model](#prerequisites--mental-model)
2. [Part 1: Checkbox Visibility (Warmup)](#part-1-checkbox-visibility-warmup)
3. [Part 2: Sort State Architecture](#part-2-sort-state-architecture)
4. [Part 3: SortableColumnHeader Component](#part-3-sortablecolumnheader-component)
5. [Part 4: Column Visibility & the View Button](#part-4-column-visibility--the-view-button)
6. [Part 5: Bulk Actions](#part-5-bulk-actions)
7. [Part 6: Terminal Spawning Micro-Server](#part-6-terminal-spawning-micro-server)
8. [Testing & Verification](#testing--verification)

---

## Prerequisites & Mental Model

### Think of State Like a Film Edit Suite

Before diving in, let's establish a mental model:

- **Component State** = Your editing console (where you control what appears on screen)
- **Props** = The signal being sent to sub-components (like monitors on different desks)
- **Derived Values** = Computed results based on state (like a final render with color grading applied)

When you have **sorting**, it's like deciding the order of your shots. When you have **column visibility**, it's like toggling which monitors are on/off in your suite. When you have **bulk actions**, it's like selecting multiple clips at once and applying an effect to all of them.

### Key Files You'll Touch

- `src/components/TaskTable.tsx` — The main stage where all the logic lives
- `src/components/ui/checkbox.tsx` — Single-line cosmetic fix
- `scripts/spawn-terminal.ts` — New file: a tiny server (like a remote control)
- `package.json` — Update the dev script to start that server

### Quick Terminal Check

Before starting, verify your environment:

```bash
# Check Bun is working
bun --version

# Run current dev setup
bun run dev
# You should see 2 processes start (Vite on 5173, json-server on 3001)
```

---

## Part 1: Checkbox Visibility (Warmup)

**Goal:** Make unchecked checkboxes visible against the dark background.

### Understanding the Problem

Open `src/components/ui/checkbox.tsx` and look at line 17. The unchecked border uses `border-stone-600`, which is quite dark. Against the `bg-stone-950` (almost black) background of task rows, it's nearly invisible.

Think of it like this: Your footage is backlit, and you need to increase the exposure on the border (make it lighter).

### The Fix

Navigate to `src/components/ui/checkbox.tsx` and find:

```tsx
border-stone-600  // ← Change this line
```

Change it to:

```tsx
border-stone-400  // ← Lighter gray, more visible
```

**Why this number?**
- `stone-600` = RGB(120, 113, 108) — too close to the background
- `stone-400` = RGB(168, 162, 158) — mid-gray, noticeable but not harsh

### Test It

1. Save the file
2. In your browser, look at the unchecked checkbox in the TaskTable
3. You should see a clear mid-gray border around empty boxes

✅ **Done!** This is a one-liner warmup. Now for the real work.

---

## Part 2: Sort State Architecture

**Goal:** Understand how to manage sorting state for multiple columns.

### The Current Architecture (What You're Replacing)

Open `src/components/TaskTable.tsx` and scroll to line ~461. You'll see:

```ts
const [sortDir, setSortDir] = useState<SortDir>(null)
```

This is a **single value**: just the direction (ascending, descending, or null). It works *only* for the Status column because Status is the only sortable column currently.

**The problem:** You can't represent "sort Task column ascending" and "Status column is unsorted" at the same time with just a direction. You need to track **which column** is being sorted *and* in what direction.

### The Mental Model Shift

Think of it like organizing footage on a timeline:

- **Old way:** "Is the timeline sorted? Ascending or descending?" (one boolean choice)
- **New way:** "Which track is the primary sort? Task name? Status? Progress? And what direction?"

You need a data structure that holds both pieces of information.

### The Types You'll Add

In `TaskTable.tsx`, find the section with existing type definitions (around line 111). Delete:

```ts
type SortDir = 'asc' | 'desc' | null  // ← DELETE THIS
```

And add these new types instead (right after existing interfaces):

```ts
type SortCol = 'task' | 'status' | 'agent' | 'progress' | 'duration'

interface SortState {
  col: SortCol | null      // Which column (or none)
  dir: 'asc' | 'desc'      // Always asc/desc, never null
}
```

**Why this design?**
- `col` is the **active** column being sorted, or `null` if no sort is active
- `dir` defaults to `'asc'` and doesn't need to be nullable (when `col` is null, `dir` doesn't matter, but we keep it for the next sort)
- `SortCol` is a union of the 5 sortable column names—this gives you **type safety**. If you typo a column name, TypeScript will complain immediately.

### The State Hook

Find the line with `const [sortDir, setSortDir]` and replace it with:

```ts
const [sort, setSort] = useState<SortState>({ col: null, dir: 'asc' })
```

**Translation:** "Start with no column sorted (col: null), and when I do sort something, prefer ascending order."

### The sortNodes() Helper Function

Now find the `sortNodes()` function (around line ~600). This is the **engine** that actually reorders the task tree.

**Current version** (approximately):
```ts
function sortNodes(nodes: TaskNode[]): TaskNode[] {
  // only sorts by status, ignores other columns
  // ...
}
```

**Replace it** with this new version that handles all 5 columns:

```ts
function sortNodes(nodes: TaskNode[], sort: SortState): TaskNode[] {
  if (!sort.col) return nodes  // If no column selected, don't sort

  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0

    // Each column has its own comparison logic
    if (sort.col === 'status')   cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (sort.col === 'task')     cmp = a.name.localeCompare(b.name)
    if (sort.col === 'agent')    cmp = a.agentType.localeCompare(b.agentType)
    if (sort.col === 'progress') cmp = a.progressPercentage - b.progressPercentage
    if (sort.col === 'duration') cmp = (a.startedAt ?? '').localeCompare(b.startedAt ?? '')

    // Flip the comparison if descending
    return sort.dir === 'asc' ? cmp : -cmp
  })

  // Recursively sort children (for nested tasks)
  return sorted.map(n => ({ ...n, children: sortNodes(n.children, sort) }))
}
```

**Translation of the comparison logic:**
- **status:** Use `STATUS_ORDER` (which already exists) to map statuses to numbers, then subtract
- **task:** Use `localeCompare()` for alphabetic comparison (handles case-insensitivity and special characters)
- **agent:** Same as task—string comparison
- **progress:** Numeric subtraction (higher percentages come first in ascending order)
- **duration:** Compare the `startedAt` timestamps as strings (ISO format sorts chronologically)

Then, flip the result if `dir === 'desc'`: multiply by `-1` to reverse the order.

### Update the useMemo

Find the `useMemo` that computes `flatTasks` (around line ~500). Inside it, you'll see a call to `sortNodes()`.

**Change from:**
```ts
const flatTasks = useMemo(() => {
  const tree = buildTaskTree(tasks)
  return sortNodes(tree)  // ← OLD: no argument for sort state
  // ...
}, [tasks])
```

**Change to:**
```ts
const flatTasks = useMemo(() => {
  const tree = buildTaskTree(tasks)
  return sortNodes(tree, sort)  // ← NEW: pass sort state
  // ...
}, [tasks, sort])  // ← NEW: add sort to dependency array
```

**Why the dependency array matters?**
The `useMemo` recalculates whenever `tasks` or `sort` changes. If you forget to add `sort`, changing the sort won't trigger a recalculation—the table won't re-sort. This is a common React gotcha.

### Test the State

At this point, **don't expect the UI to work yet** — you haven't added the column header buttons. But you can verify TypeScript is happy:

```bash
bun run lint
```

You should have **zero** errors related to `sort` (assuming you removed the old `sortDir` completely).

✅ **Done!** You now have a flexible sort state that can represent any single column, in either direction.

---

## Part 3: SortableColumnHeader Component

**Goal:** Create a reusable button + dropdown that lets users sort and hide columns.

### Mental Model: The Dropdown as a "Control Panel"

Each column header is like a small control panel. Click it, and you see three options:
- ⬆️ Sort ascending
- ⬇️ Sort descending
- 👁️ Hide this column

### Creating the Component

Add this new component **after the `FilterPopover` component, before `LogDetailRow`**. It's an internal helper, not exported.

```tsx
interface SortableColumnHeaderProps {
  label: string
  col: SortCol
  sort: SortState
  onSort: (col: SortCol, dir: 'asc' | 'desc') => void
  onHide: (col: string) => void
}

function SortableColumnHeader({
  label,
  col,
  sort,
  onSort,
  onHide,
}: SortableColumnHeaderProps) {
  const isActive = sort.col === col

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-stone-400 hover:text-stone-200 transition-colors group -ml-0.5 px-0.5 rounded">
          {label}
          {isActive ? (
            sort.dir === 'asc' ? (
              <IconArrowUp size={11} className="text-stone-300" />
            ) : (
              <IconArrowDown size={11} className="text-stone-300" />
            )
          ) : (
            <IconArrowsSort size={11} className="opacity-0 group-hover:opacity-60 transition-opacity" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-28">
        <DropdownMenuItem onClick={() => onSort(col, 'asc')}>
          <IconArrowUp size={13} /> Asc
          {isActive && sort.dir === 'asc' && (
            <IconCheck size={11} className="ml-auto" />
          )}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => onSort(col, 'desc')}>
          <IconArrowDown size={13} /> Desc
          {isActive && sort.dir === 'desc' && (
            <IconCheck size={11} className="ml-auto" />
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => onHide(col)} className="text-stone-400">
          <IconEyeOff size={13} /> Hide
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

### Understanding the Visual Logic

**When the column is active** (being sorted):
```tsx
{isActive ? (
  sort.dir === 'asc' ? <IconArrowUp ... /> : <IconArrowDown ... />
) : (
  <IconArrowsSort ... /> // only visible on hover at 60% opacity
)}
```

Translation:
- If this is the active sort column → Always show ↑ or ↓ (visible, not hidden)
- If this is NOT the active sort column → Show the "sort" icon, but at 60% opacity and only visible when you hover over the button

This gives visual feedback: "this column is currently sorted" vs. "this column could be sorted if you click it."

### Import the New Icons

At the top of `TaskTable.tsx`, find the Tabler icon imports and add:

```ts
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconCheck,          // ← ADD THIS
  IconEyeOff,        // ← ADD THIS
  IconLayoutColumns, // ← ADD THIS (used later for View button)
  // ... other icons
} from '@tabler/icons-react'
```

### Add Callback Handlers

Inside the `TaskTable` component body, add these handlers (around where other handlers like `patchTask` are defined):

```ts
const handleSort = (col: SortCol, dir: 'asc' | 'desc') => {
  setSort({ col, dir })
}

const handleHideColumn = (col: string) => {
  // Implemented in Part 4, stub for now
  console.log('Hide column:', col)
}
```

### Replace Column Headers in the Table

Find where the table header is rendered. You'll see something like:

```tsx
<TableHeader>
  <TableRow>
    <TableHead className="w-12">...</TableHead>
    <TableHead>Task</TableHead>
    <TableHead>Status</TableHead>
    {/* ... more columns */}
  </TableRow>
</TableHeader>
```

Replace the text headers with `<SortableColumnHeader>` components:

```tsx
<TableHeader>
  <TableRow>
    <TableHead className="w-12">...</TableHead>
    <SortableColumnHeader
      label="Task"
      col="task"
      sort={sort}
      onSort={handleSort}
      onHide={handleHideColumn}
    />
    <SortableColumnHeader
      label="Status"
      col="status"
      sort={sort}
      onSort={handleSort}
      onHide={handleHideColumn}
    />
    {/* ... similar for Agent, Progress, Duration */}
  </TableRow>
</TableHeader>
```

### Test It

Save and reload. Click on a column header dropdown:
- ✅ Should see Asc/Desc/Hide options
- ✅ Clicking Asc should sort that column and show ↑
- ✅ Clicking Desc should reverse the sort and show ↓
- ✅ Clicking another column should switch the active sort
- ✅ The old "active" column should go back to showing the dimmed icon on hover

---

## Part 4: Column Visibility & the View Button

**Goal:** Let users toggle columns on/off, with a View button in the toolbar.

### The State

Add this state hook alongside `sort`:

```ts
const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
```

**Why a Set?**
- Sets are optimized for fast lookups: `hiddenCols.has('task')` is O(1)
- Immutable patterns are cleaner: `const next = new Set(prev); next.add('task')`
- We don't need ordering, just membership: "is this column hidden?"

### Move TOTAL_COLS into Component Body

Find where `TOTAL_COLS` is defined (probably at module scope, around line 452). Delete it from there.

Add it inside the component body, using `hiddenCols.size`:

```ts
const TOTAL_COLS = 8 - hiddenCols.size
```

**Why dynamically?**
The colSpan for log detail rows needs to match the number of visible columns. If you hide 2 columns, the detail row should span 6 columns instead of 8.

### The toggleCol Helper

Add this function inside the component body (near the sort handler):

```ts
const ALWAYS_VISIBLE = new Set(['status', 'taskId'])

const toggleCol = (col: string) => {
  if (ALWAYS_VISIBLE.has(col)) return  // Can't hide these

  setHiddenCols(prev => {
    const next = new Set(prev)
    if (next.has(col)) {
      // Column is hidden, so show it
      next.delete(col)
    } else {
      // Column is visible, so hide it
      next.add(col)
      // If this column is currently sorted, clear the sort
      if (sort.col === col) {
        setSort({ col: null, dir: 'asc' })
      }
    }
    return next
  })
}
```

**Translation:**
- Check if the column is "always visible" (Status and Task ID can never be hidden)
- If it's already hidden, show it again
- If it's visible, hide it
- **Smart behavior:** If I'm hiding the column I'm sorting by, the sort stops making sense. Reset it.

### Update handleHideColumn

Replace the stub from Part 3:

```ts
const handleHideColumn = (col: string) => {
  toggleCol(col)
}
```

### Add the View Button

Find the toolbar section (where the Search, Status filter, Agent filter buttons are). At the **right side**, before New Agent and Refresh, add:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm" className="gap-1.5">
      <IconLayoutColumns size={13} /> View
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
    <DropdownMenuSeparator />
    {(['task', 'agent', 'progress', 'duration'] as const).map(col => (
      <DropdownMenuItem key={col} onClick={() => toggleCol(col)}>
        <span className="w-3.5">
          {!hiddenCols.has(col) && <IconCheck size={13} />}
        </span>
        <span className="capitalize">{col}</span>
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

**Why `as const`?**
This tells TypeScript to treat the array values as literal strings ('task', 'agent', etc.), not generic `string` type. This lets TypeScript verify you're mapping over valid `SortCol` values.

### Conditional Rendering

Now, in the table header and each task row, **conditionally render columns** based on `hiddenCols`:

**In TableHeader:**
```tsx
<TableHeader>
  <TableRow>
    <TableHead className="w-12">...</TableHead>
    {!hiddenCols.has('task') && (
      <SortableColumnHeader
        label="Task"
        col="task"
        sort={sort}
        onSort={handleSort}
        onHide={handleHideColumn}
      />
    )}
    {/* Status always shows, no guard */}
    <SortableColumnHeader
      label="Status"
      col="status"
      sort={sort}
      onSort={handleSort}
      onHide={handleHideColumn}
    />
    {!hiddenCols.has('agent') && (
      <SortableColumnHeader
        label="Agent"
        col="agent"
        sort={sort}
        onSort={handleSort}
        onHide={handleHideColumn}
      />
    )}
    {/* ... similar for progress, duration */}
  </TableRow>
</TableHeader>
```

**In TaskRow (inside the render function):**
```tsx
{!hiddenCols.has('task') && <TableCell>{/* task content */}</TableCell>}
{/* status cell always rendered */}
{!hiddenCols.has('agent') && <TableCell>{/* agent content */}</TableCell>}
{/* ... etc */}
```

### Pass hiddenCols to TaskRow

Update the `TaskRowProps` interface to include:

```ts
interface TaskRowProps {
  // ... existing props
  hiddenCols: Set<string>
}
```

And pass it when rendering:

```tsx
<TaskRow
  node={node}
  hiddenCols={hiddenCols}
  // ... other props
/>
```

### Test It

Save and reload:
- ✅ Click View button, see checkmarks next to visible columns
- ✅ Click "Task" in View menu → Task column disappears from table
- ✅ Click View again → Task still has no checkmark
- ✅ Click "Task" again → Task column reappears with checkmark
- ✅ Hide the column you're currently sorting by → Sort should reset to `col: null`
- ✅ Log detail rows should still span the correct number of columns

---

## Part 5: Bulk Actions

**Goal:** Let users select multiple rows and apply actions (Cancel, Pause, Retry, Delete).

### The Context: What Are Bulk Actions?

Imagine you have 10 tasks running. Five of them are "stuck" in a state. Instead of clicking each one individually, you:
1. **Select** them (checkboxes)
2. Click a **bulk action** button
3. All 5 update instantly

This is like batch-processing in video: "Apply this color grade to all 5 clips at once."

### The Handlers

Add these helper functions alongside `patchTask`:

```ts
async function deleteTask(id: string) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${id} failed: HTTP ${res.status}`)
}
```

Then, inside the component body, add the bulk action handlers:

```ts
const handleBulkAction = async (action: 'cancel' | 'pause' | 'retry') => {
  // Mark all selected rows as busy with this action
  setBusy(prev => {
    const n = { ...prev }
    for (const id of selectedRows) {
      n[id] = action
    }
    return n
  })

  try {
    // Determine what to PATCH based on the action
    const patch =
      action === 'cancel'
        ? { status: 'cancelled' as TaskStatus }
        : action === 'pause'
          ? { status: 'paused' as TaskStatus }
          : { status: 'running' as TaskStatus, progressPercentage: 0 }

    // Send all PATCHes in parallel
    await Promise.all([...selectedRows].map(id => patchTask(id, patch)))

    // Clear selection and refresh
    setSelectedRows(new Set())
    onRefresh()
  } finally {
    // Always clear the busy state
    setBusy(prev => {
      const n = { ...prev }
      for (const id of selectedRows) {
        delete n[id]
      }
      return n
    })
  }
}

const handleBulkDelete = async () => {
  // Same pattern: mark busy, delete all, clear busy
  setBusy(prev => {
    const n = { ...prev }
    for (const id of selectedRows) {
      n[id] = 'delete'
    }
    return n
  })

  try {
    await Promise.all([...selectedRows].map(id => deleteTask(id)))
    setSelectedRows(new Set())
    onRefresh()
  } finally {
    setBusy(prev => {
      const n = { ...prev }
      for (const id of selectedRows) {
        delete n[id]
      }
      return n
    })
  }
}
```

### The Bulk Action Bar UI

Below the toolbar, add this **conditionally rendered bar** (only shows when rows are selected):

```tsx
{selectedRows.size > 0 && (
  <div className="flex items-center gap-2 rounded-(--radius) border border-stone-800 bg-stone-900/80 px-3 py-1.5">
    <span className="text-xs text-stone-400 tabular-nums">
      {selectedRows.size} selected
    </span>

    <div className="flex items-center gap-1 ml-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleBulkAction('cancel')}
      >
        Cancel
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleBulkAction('pause')}
      >
        Pause
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleBulkAction('retry')}
      >
        Retry
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleBulkDelete}
      >
        Delete
      </Button>
    </div>

    <Button
      variant="ghost"
      size="sm"
      onClick={() => setSelectedRows(new Set())}
      className="ml-auto gap-1"
    >
      <IconX size={12} /> Clear
    </Button>
  </div>
)}
```

**Visual hierarchy:**
- Count of selected rows (dim text, monospace for alignment)
- Action buttons (cancel, pause, retry)
- Delete button (destructive red, separated from the rest)
- Clear button (far right, clears the selection without doing anything)

### Test It

- ✅ Check 2+ rows
- ✅ Bulk action bar appears below toolbar
- ✅ Click "Cancel" → all selected rows' status changes to "Cancelled"
- ✅ Click "Pause" → all selected rows' status changes to "Paused"
- ✅ Click "Retry" → all selected rows' status resets to "Running" with 0% progress
- ✅ Click "Delete" → all selected rows disappear (removed from db.json)
- ✅ Click "Clear" → selection clears, bar disappears

---

## Part 6: Terminal Spawning Micro-Server

**Goal:** Add a "New Agent" button that launches Ghostty with Claude Code.

### Why a Micro-Server?

Browsers can't directly execute shell commands for security reasons. So we create a tiny **local server** that:
1. Listens for a POST request
2. Spawns the terminal
3. Responds with "OK"

It's like a remote control for your OS.

### Create the Server File

Create a new file: `scripts/spawn-terminal.ts`

```ts
const PORT = 3002

const cors = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Bun.serve({
  port: PORT,
  fetch(req) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Handle the spawn request
    if (req.method === 'POST' && new URL(req.url).pathname === '/spawn') {
      Bun.spawn(['open', '-a', 'Ghostty', '--args', '--command', 'claude'])
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // 404 for anything else
    return new Response('Not found', { status: 404 })
  },
})

console.log(`Spawn server on http://localhost:${PORT}`)
```

**Translation:**
- **CORS headers:** Allow the browser (localhost:5173) to make POST requests
- **OPTIONS:** Browsers send this first to check if cross-origin requests are allowed
- **POST /spawn:** The actual endpoint—runs `open -a Ghostty --args --command claude`
  - `open -a Ghostty` = launch the Ghostty app (macOS-specific)
  - `--args --command claude` = pass these arguments to Ghostty, which runs the `claude` command

### Update package.json

Find the `"dev"` script:

```json
"dev": "concurrently \"vite --port 5173\" \"json-server --watch db.json --port 3001\""
```

Update it to start the spawn server too:

```json
"dev": "concurrently \"vite --port 5173\" \"json-server --watch db.json --port 3001\" \"bun scripts/spawn-terminal.ts\""
```

Now when you run `bun run dev`, three processes start:
1. Vite (frontend, port 5173)
2. json-server (mock API, port 3001)
3. spawn-terminal server (terminal launcher, port 3002)

### The "New Agent" Button

In the toolbar, find where you'll add the right-side buttons (View, Refresh, etc.). Add:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="gap-1.5"
  onClick={() =>
    fetch('http://localhost:3002/spawn', { method: 'POST' }).catch(
      console.error
    )
  }
>
  <IconTerminal2 size={13} />
  New Agent
</Button>
```

**Why `IconTerminal2`?** There are two terminal icons in Tabler. This one looks more like a terminal prompt.

Add it to your imports:

```ts
import { IconTerminal2 /* ... other icons */ } from '@tabler/icons-react'
```

### Understanding the Flow

1. **User clicks** "New Agent"
2. **Browser sends** a POST request to `http://localhost:3002/spawn`
3. **spawn-terminal server** receives it and runs `Bun.spawn(['open', '-a', 'Ghostty', '--args', '--command', 'claude'])`
4. **macOS** launches Ghostty with the `claude` command
5. **Ghostty** starts Claude Code inside your terminal
6. **Server responds** with `{ ok: true }` (the browser doesn't need to do anything with this)

### Test It

1. Save all files
2. Run `bun run dev` — you should see 3 processes starting
3. Click "New Agent" → Ghostty should open with Claude Code running

---

## Testing & Verification

### Checklist

Work through each feature:

- [ ] **Checkbox:** Unchecked boxes have a visible mid-gray border
- [ ] **Sort:** Click Task header → sorts by name → shows ↑ → click again → Desc → shows ↓
- [ ] **Sort multi:** Click Task to sort, then click Agent → Agent is now sorted, Task goes back to hover icon
- [ ] **Sort resets:** Sorting by "Task", then click View → Hide "Task" → sort resets
- [ ] **Hide column:** Task disappears from header and all rows
- [ ] **TOTAL_COLS:** Log detail rows (when expanded) span the correct number of columns
- [ ] **View button:** Toggling columns shows/hides them with checkmarks
- [ ] **Select rows:** Click 2+ checkboxes → bulk action bar appears
- [ ] **Bulk Cancel:** Select rows, click Cancel → all statuses change to "Cancelled"
- [ ] **Bulk Pause:** Select rows, click Pause → all statuses change to "Paused"
- [ ] **Bulk Retry:** Select rows, click Retry → all statuses change to "Running", progress to 0%
- [ ] **Bulk Delete:** Select rows, click Delete → rows disappear, db.json updated
- [ ] **Clear selection:** Click "Clear" button → selection cleared, bar disappears
- [ ] **New Agent:** Click button → Ghostty opens with Claude Code

### Debugging Tips

**Sort not working?**
- Check that `sortNodes()` is being called with both `tree` and `sort`
- Check that `sort` is in the `useMemo` dependency array
- Open browser DevTools → Console → check for JavaScript errors

**Columns not hiding?**
- Check that `hiddenCols` is being passed to TaskRow
- Check that you have `{!hiddenCols.has('columnName') && ...}` guards around conditional columns
- Log `hiddenCols` to the console to verify it's updating

**Server not starting?**
- Run `bun run dev` and look for "Spawn server on http://localhost:3002" in the output
- If missing, check for errors in the terminal
- Try running `bun scripts/spawn-terminal.ts` directly to debug

**New Agent button not working?**
- Open browser DevTools → Network tab
- Click "New Agent"
- Check if a POST request appears to localhost:3002/spawn
- If yes, check the response
- If no, the fetch might be blocked by CORS (though it shouldn't be with the headers we set)

---

## Wrapping Up

You've now implemented:
1. ✅ **Visual fix** (checkbox border)
2. ✅ **Multi-column sort** with single-active-column constraint
3. ✅ **SortableColumnHeader** component pattern (reusable, composable)
4. ✅ **Column visibility** with smart state transitions
5. ✅ **Bulk actions** leveraging existing state patterns
6. ✅ **Terminal spawning** via a micro-server

### Key Takeaways

- **State Design:** Think about what your state needs to represent, then design the minimal data structure
- **Type Safety:** Use TypeScript unions (`type SortCol`) to prevent bugs at compile time
- **Composition:** Small, focused components like `SortableColumnHeader` are easier to reason about
- **Conditional Rendering:** Use `{condition && <Component />}` to toggle parts of the UI
- **Handlers:** Group related state updates into functions (e.g., `handleSort`, `handleBulkAction`)
- **Sets for Membership:** Use `Set<string>` for efficient "is X hidden?" checks
- **Micro-servers:** Sometimes you need a tiny server just to bridge the browser-to-OS gap

Good luck! 🎬
