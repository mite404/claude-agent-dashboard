# TaskTable Feature Expansion

## Context
The TaskTable component needs several UX improvements discovered during active use:
- Checkboxes are barely visible against the dark background
- Only the Status column is sortable; all other columns should be too
- Column visibility (hide/show) is missing
- Selection exists but has no actions (bulk delete/cancel/pause/retry needed)
- A quick-launch "New Agent" button to open Ghostty + Claude Code from the dashboard

Single-column sort at a time (Option A). Task ID and Status always visible.

---

## Critical Files
- `src/components/TaskTable.tsx` — main file (~750 lines), all sort/visibility/bulk/spawn logic
- `src/components/ui/checkbox.tsx` — one-line border fix
- `package.json` — add spawn server to dev script
- `scripts/spawn-terminal.ts` — new Bun micro-server (new file)

---

## Step 1: Checkbox Visibility Fix
**File:** `src/components/ui/checkbox.tsx` line 17

Change unchecked border:
```
border-stone-600  →  border-stone-400
```

---

## Step 2: Sort State Refactor

**Remove** from `TaskTable.tsx`:
- `type SortDir = 'asc' | 'desc' | null` (line 111)
- `const [sortDir, setSortDir] = useState<SortDir>(null)` (line 461)
- `const cycleSort = ...` (lines 605-607)

**Add** new types (after existing interfaces):
```ts
type SortCol = 'task' | 'status' | 'agent' | 'progress' | 'duration'
interface SortState { col: SortCol | null; dir: 'asc' | 'desc' }
```

**Add** state:
```ts
const [sort, setSort] = useState<SortState>({ col: null, dir: 'asc' })
```

**Replace** `sortNodes()` helper:
```ts
function sortNodes(nodes: TaskNode[], sort: SortState): TaskNode[] {
  if (!sort.col) return nodes
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0
    if (sort.col === 'status')   cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (sort.col === 'task')     cmp = a.name.localeCompare(b.name)
    if (sort.col === 'agent')    cmp = a.agentType.localeCompare(b.agentType)
    if (sort.col === 'progress') cmp = a.progressPercentage - b.progressPercentage
    if (sort.col === 'duration') cmp = (a.startedAt ?? '').localeCompare(b.startedAt ?? '')
    return sort.dir === 'asc' ? cmp : -cmp
  })
  return sorted.map(n => ({ ...n, children: sortNodes(n.children, sort) }))
}
```

**Update** `flatTasks` useMemo: `sortNodes(tree, sort)` and add `sort` to deps array.

---

## Step 3: SortableColumnHeader Sub-component

Add internal component after `FilterPopover`, before `LogDetailRow`. Uses existing `DropdownMenu` primitives.

```tsx
function SortableColumnHeader({ label, col, sort, onSort, onHide }) {
  const isActive = sort.col === col
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-stone-400 hover:text-stone-200 transition-colors group -ml-0.5 px-0.5 rounded">
          {label}
          {isActive
            ? (sort.dir === 'asc' ? <IconArrowUp size={11} className="text-stone-300" /> : <IconArrowDown size={11} className="text-stone-300" />)
            : <IconArrowsSort size={11} className="opacity-0 group-hover:opacity-60 transition-opacity" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-28">
        <DropdownMenuItem onClick={() => onSort(col, 'asc')}>
          <IconArrowUp size={13} /> Asc
          {isActive && sort.dir === 'asc' && <IconCheck size={11} className="ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSort(col, 'desc')}>
          <IconArrowDown size={13} /> Desc
          {isActive && sort.dir === 'desc' && <IconCheck size={11} className="ml-auto" />}
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

Add to Tabler icon imports: `IconCheck`, `IconEyeOff`, `IconLayoutColumns`

Replace all column headers (Task, Status, Agent, Progress, Duration) with `<SortableColumnHeader>`.

**UX behavior:**
- Active sort: always shows ↑ or ↓ (no hover needed)
- Inactive: shows `IconArrowsSort` on hover only at 60% opacity

---

## Step 4: Column Visibility

**Add state:**
```ts
const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
```

**Move `TOTAL_COLS`** from module scope (line 452) into component body:
```ts
const TOTAL_COLS = 8 - hiddenCols.size  // toggleable: task, agent, progress, duration
```

**Add `toggleCol` helper** (clears sort if hiding active column):
```ts
const ALWAYS_VISIBLE = new Set(['status'])
const toggleCol = (col: string) => {
  if (ALWAYS_VISIBLE.has(col)) return
  setHiddenCols(prev => {
    const next = new Set(prev)
    if (next.has(col)) { next.delete(col) }
    else {
      next.add(col)
      if (sort.col === col) setSort({ col: null, dir: 'asc' })
    }
    return next
  })
}
```

**Add `hiddenCols` to `TaskRowProps`** and pass it through from `TaskTable`.

**Wrap toggleable columns** in both `TableHeader` and `TaskRow` with `{!hiddenCols.has('X') && ...}` guards for: `task`, `agent`, `progress`, `duration`.

**"View" button** in toolbar (right cluster, before New Agent and Refresh):
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
        <span className="w-3.5">{!hiddenCols.has(col) && <IconCheck size={13} />}</span>
        <span className="capitalize">{col}</span>
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

**Final toolbar order (left → right):**
`[Search] [Status▼] [Agent▼] [Reset?]` ... `ml-auto` ... `[View▼] [New Agent] [Refresh]`

Wrap right cluster in `<div className="flex items-center gap-1 ml-auto">`.

---

## Step 5: Bulk Actions

**Add `deleteTask` helper** (alongside `patchTask`):
```ts
async function deleteTask(id: string) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${id} failed: HTTP ${res.status}`)
}
```

**Add bulk handlers** inside component:
```ts
const handleBulkAction = async (action: 'cancel' | 'pause' | 'retry') => {
  setBusy(prev => { const n = {...prev}; for (const id of selectedRows) n[id] = action; return n })
  try {
    const patch = action === 'cancel' ? { status: 'cancelled' as TaskStatus }
                : action === 'pause'  ? { status: 'paused' as TaskStatus }
                : { status: 'running' as TaskStatus, progressPercentage: 0 }
    await Promise.all([...selectedRows].map(id => patchTask(id, patch)))
    setSelectedRows(new Set())
    onRefresh()
  } finally {
    setBusy(prev => { const n = {...prev}; for (const id of selectedRows) delete n[id]; return n })
  }
}

const handleBulkDelete = async () => {
  setBusy(prev => { const n = {...prev}; for (const id of selectedRows) n[id] = 'delete'; return n })
  try {
    await Promise.all([...selectedRows].map(id => deleteTask(id)))
    setSelectedRows(new Set())
    onRefresh()
  } finally {
    setBusy(prev => { const n = {...prev}; for (const id of selectedRows) delete n[id]; return n })
  }
}
```

**Bulk action bar JSX** (between toolbar and table, renders when `selectedRows.size > 0`):
```tsx
{selectedRows.size > 0 && (
  <div className="flex items-center gap-2 rounded-(--radius) border border-stone-800 bg-stone-900/80 px-3 py-1.5">
    <span className="text-xs text-stone-400 tabular-nums">{selectedRows.size} selected</span>
    <div className="flex items-center gap-1 ml-2">
      <Button variant="ghost" size="sm" onClick={() => handleBulkAction('cancel')}>Cancel</Button>
      <Button variant="ghost" size="sm" onClick={() => handleBulkAction('pause')}>Pause</Button>
      <Button variant="ghost" size="sm" onClick={() => handleBulkAction('retry')}>Retry</Button>
      <Button variant="destructive" size="sm" onClick={handleBulkDelete}>Delete</Button>
    </div>
    <Button variant="ghost" size="sm" onClick={() => setSelectedRows(new Set())} className="ml-auto gap-1">
      <IconX size={12} /> Clear
    </Button>
  </div>
)}
```

Note: Delete removes the record from db.json. "Kill process" applies when real Claude Code integration is wired — the backend will handle process termination then.

---

## Step 6: Spawn Terminal Micro-Server

**New file:** `scripts/spawn-terminal.ts`
```ts
const PORT = 3002
const cors = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Bun.serve({
  port: PORT,
  fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method === 'POST' && new URL(req.url).pathname === '/spawn') {
      Bun.spawn(['open', '-a', 'Ghostty', '--args', '--command', 'claude'])
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Spawn server on http://localhost:${PORT}`)
```

**Update `package.json` dev script:**
```json
"dev": "concurrently \"vite --port 5173\" \"json-server --watch db.json --port 3001\" \"bun scripts/spawn-terminal.ts\""
```

**"New Agent" button** in toolbar (right cluster):
```tsx
<Button variant="ghost" size="sm" className="gap-1.5"
  onClick={() => fetch('http://localhost:3002/spawn', { method: 'POST' }).catch(console.error)}>
  <IconTerminal2 size={13} />
  New Agent
</Button>
```

---

## Verification

1. **Checkbox:** Unchecked boxes should have a visible mid-gray border (stone-400) against the dark background
2. **Sort:** Click any column header dropdown → Asc/Desc sorts correctly → only one column active at a time → active column shows ↑ or ↓
3. **Hide:** Click "Hide" in column header dropdown → column disappears from header and all rows → TOTAL_COLS adjusts (colSpan in log detail rows correct) → if sorted column is hidden, sort resets
4. **View button:** Toggling columns via View dropdown shows/hides them with checkmarks
5. **Bulk actions:** Select 2+ rows → contextual bar appears → Cancel/Pause/Retry patches status → Delete removes records and refreshes
6. **New Agent:** Click button → Ghostty opens → `claude` command runs
