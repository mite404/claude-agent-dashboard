# TaskTable Feature Expansion — Challenge-Based Tutorial

**Audience:** Visual learner with design/film background
**Goal:** Implement checkbox visibility fix, bulk actions, and terminal spawning
**Estimated Time:** 60–90 minutes (hands-on)

---

## Table of Contents

1. [Mental Model: The Control Panel](#mental-model)
2. [Challenge 1: Checkbox Visibility](#challenge-1-checkbox-visibility)
3. [Challenge 2: Bulk Action Handlers](#challenge-2-bulk-action-handlers)
4. [Challenge 3: Bulk Action UI](#challenge-3-bulk-action-ui)
5. [Challenge 4: Spawn Terminal Server](#challenge-4-spawn-terminal-server)
6. [Full Solutions](#full-solutions)

---

## Mental Model: The Control Panel

Think of the TaskTable like a **film editing suite**:

- **Checkboxes** = the selection UI (what you click to mark clips)
- **Bulk actions** = the batch operations (like "delete all selected clips at once")
- **Spawn server** = the on-set PA who opens doors (launches Ghostty + Claude)

When you select multiple rows, a **contextual action bar** appears—like a toolbar that only shows when you need it. This pattern is used by Gmail, Notion, Linear.

The server spawning is a **sidecar pattern**: your browser can't launch native processes, so you have a tiny HTTP server that can.

---

## Challenge 1: Checkbox Visibility

**File:** `src/components/ui/checkbox.tsx`

**Problem:** The unchecked checkbox border (currently `stone-600`) has poor contrast against the dark page background. The checkmark also needs better contrast.

**Your Task:**

1. Replace the Tailwind `border-stone-600` with the project's **CSS variable** for better contrast
2. Fix the checkmark color to ensure visibility

### Hint

The project defines custom OKLCH colors in `src/index.css` under `@theme {}`:

```
--color-border-muted: oklch(0.34 0.004 17.2)  /* stone-600 */
--color-text-secondary: oklch(0.88 0.003 17.2) /* stone-200 */
```

Use CSS variable syntax in Tailwind: `[border-color:var(--color-border-muted)]`

### Starting Code

```tsx
// src/components/ui/checkbox.tsx
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, onChange, onCheckedChange, checked, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onChange ?? onCheckedChange}
      className={cn(
        "h-4 w-4 shrink-0 rounded-sm border-2 bg-transparent",
        // ❌ Fix these: use CSS variables, not Tailwind colors
        "[border-color:___________]",
        "data-state-checked:[border-color:___________] data-state-checked:[background-color:___________]",
        "data-state-indeterminate:[border-color:___________] data-state-indeterminate:[background-color:___________]",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center ___________">
        {/* Checkmark icon */}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
```

**Questions to answer:**

- What CSS variable represents the mid-gray unchecked border?
- What CSS variable represents the light background when checked?
- What color should the checkmark be for visibility?

---

## Challenge 2: Bulk Action Handlers

**File:** `src/components/TaskTable.tsx`

**Problem:** When users select multiple rows, there's no way to bulk delete, cancel, or pause them.

**Your Task:**

1. Add a `deleteTask()` helper (like `patchTask`, but DELETE)
2. Add `handleBulkAction()` to patch multiple tasks
3. Add `handleBulkDelete()` to delete multiple tasks

### Hint

Both handlers follow this pattern:

1. Set busy state for all selected rows
2. Fire all requests concurrently with `Promise.all()`
3. On success: clear selection and refresh
4. Always cleanup busy state in `finally`

The `deleteTask` helper mirrors the `patchTask` helper but uses `method: 'DELETE'`.

### Starting Code

**Module-level helper (after `patchTask`):**

```typescript
// ❌ Add this helper
async function deleteTask(id: string) {
  // TODO: Fetch DELETE /api/tasks/${id}
  // Throw error if !res.ok
}
```

**Inside the component (after `handleAction`):**

```typescript
const handleBulkAction = async (action: 'cancel' | 'pause' | 'retry') => {
  // TODO: Set busy state for all selectedRows
  try {
    // TODO: Build patch based on action type:
    // - 'cancel' → { status: 'cancelled' as TaskStatus }
    // - 'pause' → { status: 'paused' as TaskStatus }
    // - 'retry' → { status: 'running' as TaskStatus, progressPercentage: 0 }

    // TODO: Promise.all all patchTask calls
    // TODO: setSelectedRows(new Set())
    // TODO: onRefresh()
  } finally {
    // TODO: Clean up busy state for all selectedRows
  }
}

const handleBulkDelete = async () => {
  // TODO: Same pattern but:
  // - Set busy as 'delete' for all rows
  // - Call deleteTask() for each row
  // - Clear and refresh on success
}
```

**Questions to answer:**

- Why do we set busy state at the beginning AND in the finally block?
- Why use `Promise.all()` instead of `await`ing each request sequentially?
- What happens if one deletion fails mid-batch?

---

## Challenge 3: Bulk Action UI

**File:** `src/components/TaskTable.tsx`

**Problem:** The handlers exist, but there's no UI to trigger them. Also, the "New Agent" button is missing.

**Your Task:**

1. Add a **contextual bulk action bar** that appears when rows are selected
2. Add a **"New Agent" button** to the toolbar that spawns Ghostty

### Hint

The bulk action bar is a simple conditional JSX block that:

- Only renders if `selectedRows.size > 0`
- Has buttons for Cancel / Pause / Retry / Delete
- Shows "X selected" count
- Has a Clear button to deselect all

The "New Agent" button fires a POST to `http://localhost:3002/spawn`.

### Starting Code

**In the toolbar (around line 686):**

```tsx
{/* Right cluster — with ml-auto */}
<div className="flex items-center gap-1 ml-auto">
  {/* TODO: New Agent button
      - variant="ghost" size="sm"
      - onClick fires fetch('http://localhost:3002/spawn', { method: 'POST' })
      - Icon: IconTerminal2
      - Text: "New Agent"
  */}

  <Button
    variant="ghost"
    size="sm"
    onClick={onRefresh}
    disabled={loading}
    className="gap-1.5"
  >
    <IconRefresh size={13} className={loading ? "animate-spin" : ""} />
    Refresh
  </Button>
</div>
```

**Between toolbar and table (around line 704):**

```tsx
{/* TODO: Bulk action bar - only renders when selectedRows.size > 0
    - Show "{selectedRows.size} selected" text
    - Button cluster: Cancel, Pause, Retry, Delete
    - "Clear" button on the right (ml-auto)
    - Border + bg styling: border-stone-800 bg-stone-900/80
    - Delete button: variant="destructive"
*/}

{/* Table */}
<div className="rounded-(--radius-md) border border-stone-800 overflow-hidden">
```

**Questions to answer:**

- Why does the action bar only render when `selectedRows.size > 0`?
- Why is the New Agent button wrapped in a div with `ml-auto`?
- What error handling should happen if the spawn fetch fails?

---

## Challenge 4: Spawn Terminal Server

**File:** `scripts/spawn-terminal.ts` (new file)
**File:** `package.json` (update dev script)

**Problem:** The "New Agent" button needs a server to launch Ghostty + Claude.

**Your Task:**

1. Create a micro-server on port 3002
2. Handle `POST /spawn` requests
3. Use `Bun.spawn()` to launch `open -a Ghostty --args --command claude`
4. Update the dev script to run the server

### Hint

The server is minimal:

- Define `PORT = 3002`
- Define CORS headers (Allow-Origin: localhost:5173)
- Handle OPTIONS requests (CORS preflight)
- Handle POST /spawn: call `Bun.spawn()` and return JSON

The dev script uses `concurrently` to run three processes in parallel.

### Starting Code

**`scripts/spawn-terminal.ts`:**

```typescript
// ❌ Fill in the blanks

const PORT = ___
const cors = {
  'Access-Control-Allow-Origin': '___________',
  'Access-Control-Allow-Methods': '___________',
}

Bun.serve({
  port: PORT,
  fetch(req) {
    // TODO: Handle OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') return new Response(null, { status: ___ , headers: cors })

    // TODO: Handle POST /spawn
    if (req.method === 'POST' && new URL(req.url).pathname === '/spawn') {
      // Spawn: open -a Ghostty --args --command claude
      Bun.spawn([___, ___, ___, ___, ___])

      // Return JSON response
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
})
console.log(`Spawn server on http://localhost:${PORT}`)
```

**`package.json` dev script:**

```json
{
  "scripts": {
    "dev": "concurrently \"vite --port 5173\" \"json-server --watch db.json --port 3001\" \"___________\""
  }
}
```

**Questions to answer:**

- Why return `status: 204` for OPTIONS instead of 200?
- Why is CORS needed for a local server?
- What happens if Ghostty isn't installed?

---

## Full Solutions

### ✓ Challenge 1: Checkbox

```tsx
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, onChange, onCheckedChange, checked, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onChange ?? onCheckedChange}
      className={cn(
        "h-4 w-4 shrink-0 rounded-sm border-2 bg-transparent",
        "[border-color:var(--color-border-muted)]",
        "data-state-checked:[border-color:var(--color-text-secondary)] data-state-checked:[background-color:var(--color-text-secondary)]",
        "data-state-indeterminate:[border-color:var(--color-text-secondary)] data-state-indeterminate:[background-color:var(--color-text-secondary)]",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        {checked === "indeterminate" ? (
          <IconMinus size={10} stroke={3} />
        ) : (
          <IconCheck size={10} stroke={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
```

**Key points:**

- `[border-color:var(--color-border-muted)]` — unchecked border uses project theme (stone-600)
- `data-state-checked:` — Radix UI attributes for checked state
- `text-white` — checkmark stands out against dark page and light checkbox background

---

### ✓ Challenge 2: Handlers

```typescript
async function deleteTask(id: string) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${id} failed: HTTP ${res.status}`)
}

const handleBulkAction = async (action: 'cancel' | 'pause' | 'retry') => {
  setBusy(prev => { const n = { ...prev }; for (const id of selectedRows) n[id] = action; return n })
  try {
    const patch = action === 'cancel' ? { status: 'cancelled' as TaskStatus }
                : action === 'pause'  ? { status: 'paused'    as TaskStatus }
                : { status: 'running' as TaskStatus, progressPercentage: 0 }
    await Promise.all([...selectedRows].map(id => patchTask(id, patch)))
    setSelectedRows(new Set())
    onRefresh()
  } finally {
    setBusy(prev => { const n = { ...prev }; for (const id of selectedRows) delete n[id]; return n })
  }
}

const handleBulkDelete = async () => {
  setBusy(prev => { const n = { ...prev }; for (const id of selectedRows) n[id] = 'delete'; return n })
  try {
    await Promise.all([...selectedRows].map(id => deleteTask(id)))
    setSelectedRows(new Set())
    onRefresh()
  } finally {
    setBusy(prev => { const n = { ...prev }; for (const id of selectedRows) delete n[id]; return n })
  }
}
```

**Key points:**

- Set busy state BEFORE trying (so loading state appears immediately)
- Use `Promise.all()` for concurrent requests (all fire at once, wait for all to complete)
- Clear selection on success
- Always cleanup busy in `finally` (even if error occurs)

---

### ✓ Challenge 3: UI

**Toolbar right cluster:**

```tsx
<div className="flex items-center gap-1 ml-auto">
  <Button
    variant="ghost"
    size="sm"
    className="gap-1.5"
    onClick={() => fetch('http://localhost:3002/spawn', { method: 'POST' }).catch(console.error)}
  >
    <IconTerminal2 size={13} />
    New Agent
  </Button>
  <Button
    variant="ghost"
    size="sm"
    onClick={onRefresh}
    disabled={loading}
    className="gap-1.5"
  >
    <IconRefresh size={13} className={loading ? 'animate-spin' : ''} />
    Refresh
  </Button>
</div>
```

**Bulk action bar (between toolbar and table):**

```tsx
{selectedRows.size > 0 && (
  <div className="flex items-center gap-2 rounded-(--radius) border border-stone-800 bg-stone-900/80 px-3 py-1.5">
    <span className="text-xs text-stone-400 tabular-nums">{selectedRows.size} selected</span>
    <div className="flex items-center gap-1 ml-2">
      <Button variant="ghost" size="sm" onClick={() => handleBulkAction('cancel')}>
        Cancel
      </Button>
      <Button variant="ghost" size="sm" onClick={() => handleBulkAction('pause')}>
        Pause
      </Button>
      <Button variant="ghost" size="sm" onClick={() => handleBulkAction('retry')}>
        Retry
      </Button>
      <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
        Delete
      </Button>
    </div>
    <Button variant="ghost" size="sm" onClick={() => setSelectedRows(new Set())} className="ml-auto gap-1">
      <IconX size={12} /> Clear
    </Button>
  </div>
)}
```

**Key points:**

- Conditional rendering: only show if `selectedRows.size > 0`
- Count display: `{selectedRows.size} selected`
- Clear button is `ml-auto` to push it to the right
- Delete button uses `variant="destructive"` (red styling)

---

### ✓ Challenge 4: Spawn Server

**`scripts/spawn-terminal.ts`:**

```typescript
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

**`package.json`:**

```json
{
  "scripts": {
    "dev": "concurrently \"vite --port 5173\" \"json-server --watch db.json --port 3001\" \"bun scripts/spawn-terminal.ts\""
  }
}
```

**Key points:**

- Port 3002 (doesn't conflict with Vite 5173 or json-server 3001)
- CORS headers restrict to localhost:5173 (your frontend)
- `status: 204` for OPTIONS (successful CORS preflight, no body needed)
- `Bun.spawn(['open', '-a', 'Ghostty', '--args', '--command', 'claude'])` — macOS command to launch Ghostty with Claude
- Run all three servers in parallel via `concurrently`

---

## Testing Checklist

After implementing all four challenges:

- [ ] Unchecked checkboxes have visible mid-gray border
- [ ] Checked checkboxes show white checkmark on light background
- [ ] Select 2+ rows → bulk action bar appears
- [ ] Cancel/Pause/Retry buttons patch status correctly
- [ ] Delete button removes rows from the table
- [ ] Clear button deselects all
- [ ] "New Agent" button visible in toolbar
- [ ] Click "New Agent" → Ghostty opens with Claude
- [ ] Run `bun run dev` → three servers start (Vite, json-server, spawn)

---

## Debugging Tips

**Checkbox still hard to see?**

- Check that `src/index.css` defines the CSS variables
- Verify Tailwind is parsing `[border-color:var(...)]` syntax

**Bulk actions don't appear?**

- Verify `selectedRows.size > 0` is being checked
- Check browser console for JS errors

**New Agent button doesn't spawn Ghostty?**

- Check spawn server is running (`bun scripts/spawn-terminal.ts`)
- Verify Ghostty is installed (`which ghostty`)
- Check browser console Network tab for fetch errors

**Dev script hangs?**

- Make sure `concurrently` is installed
- Kill any existing processes on 5173, 3001, 3002

---

## Key Takeaways

1. **CSS variables** keep UI consistent with design systems
2. **Bulk handlers** follow the same busy/try/finally pattern as single actions
3. **Contextual UI** (action bar) makes interfaces less cluttered
4. **Sidecar servers** let browsers interact with the OS safely
5. **Concurrency** (`Promise.all`) speeds up multi-item operations

Good luck! 🎬
