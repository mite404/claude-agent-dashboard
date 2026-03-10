# Testing parentId Relationships in TaskTree — Challenge-Based Tutorial

**Audience:** Visual learner with design/film background
**Goal:** Set up component testing with vitest + @testing-library/react, then write tests confirming
TaskTree renders parentId relationships correctly
**Estimated Time:** 75–120 minutes (hands-on)

---

## Table of Contents

1. [Mental Model: The Test Stage](#mental-model-the-test-stage)
2. [Challenge 1: Install Testing Dependencies](#challenge-1-install-testing-dependencies)
3. [Challenge 2: Configure vitest](#challenge-2-configure-vitest)
   - Sets up jsdom environment
   - Handles path aliases and JSX transforms
4. [Challenge 3: Test buildTree Logic](#challenge-3-test-buildtree-logic)
   - Single root test
   - Parent-child-grandchild nesting
   - Orphaned children handling
   - Multiple independent trees
5. [Challenge 4: Test TaskTree Rendering](#challenge-4-test-tasktree-rendering)
   - Single task rendering
   - Parent/child indentation (pl-6 class)
   - Connector line verification
   - Callback testing with `vi.fn()`
   - Multiple nesting levels
6. [Full Solutions](#full-solutions)

---

## Mental Model: The Test Stage

Think of testing like a **film set rehearsal**:

- **Unit tests** = actors running through scenes to make sure their lines are correct
- **Component tests** = full staging with lighting, props, and camera angles
- **The test stage** = an isolated environment where nothing affects the "real" production

When you test TaskTree:

1. You **mock** the data (fake tasks and parentId relationships)
2. You **render** the component in isolation (on the test stage)
3. You **inspect** what appears on screen (what the audience sees)
4. You **assert** it matches expectations (the director says "that's a wrap!")

The `buildTree()` function is the **screenwriter**—it takes a flat script (task array) and
structures it into acts (parent-child relationships). TaskTree is the **director**—it interprets
that structure and brings it to life on screen.

---

## Challenge 1: Install Testing Dependencies

**File:** `package.json`

**Problem:** The project has no testing infrastructure. Vitest doesn't exist, and neither do
the @testing-library packages.

**Your Task:**

1. Install `vitest` as a dev dependency
2. Install `@testing-library/react` and `@testing-library/dom`
3. Install `@vitest/ui` (optional, but helpful for debugging)
4. Install `jsdom` (provides a fake DOM environment for tests)
5. Add a `test` script to package.json

### Hint

Use `bun add --save-dev` for development dependencies. Vitest is the test
runner (like Jest but faster). @testing-library/react gives you tools to render
and query React components. jsdom simulates a browser DOM in Node.js.

### Starting Code

```bash
# ❌ Run these commands
bun add --save-dev vitest @testing-library/react @testing-library/dom jsdom

# ✓ Then update package.json scripts:
{
  "scripts": {
    "test": "___________",
    "test:ui": "___________"
  }
}
```

**Questions to answer:**

- Why do we need jsdom if we're testing React components?
- What's the difference between vitest and Jest?
- Why is @testing-library/dom a separate package from @testing-library/react?

---

## Challenge 2: Configure vitest

**File:** `vitest.config.ts` (new file)

**Problem:** Vitest needs to know how to transform TypeScript, JSX, and resolve
aliases (like `@/components`).

**Your Task:**

1. Create `vitest.config.ts` at the project root
2. Set up Vitest to use your existing Vite config
3. Configure the test environment to use jsdom
4. Map path aliases (`@` → `src/`)

### Hint

Vitest can extend your `vite.config.ts` with the `defineConfig` function. The test environment needs
to be `jsdom` for DOM testing. Path aliases must match your `vite.config.ts` or `tsconfig.json`.

### Starting Code

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: '___________',
    globals: true, // Use describe/it/expect without imports
    // Optional: UI dashboard for test results
    ui: true,
  },
})
```

**Questions to answer:**

- What does `globals: true` do?
- Why use jsdom instead of node environment?
- What would happen if we didn't configure path aliases?

---

## Challenge 3: Test buildTree Logic

**File:** `src/hooks/useTaskPolling.test.ts` (new file)

**Problem:** The `buildTree()` function isn't exported, so we can't test it directly. Also, we need
to verify that parentId relationships create correct parent-child links.

**Your Task:**

1. Export `buildTree` from `useTaskPolling.ts`
2. Create a test file with three test cases:
   - **Test 3a:** Single root task with no children
   - **Test 3b:** Root task with nested children (parent-child-grandchild)
   - **Test 3c:** Multiple roots with independent children

### Hint

For test data, create a `mockTasks` array with tasks that have `parentId` values pointing to
other tasks. For example:

```typescript
const mockTasks = [
  { id: '1', name: 'Parent', parentId: null, /* ...other fields */ },
  { id: '2', name: 'Child', parentId: '1', /* ...other fields */ },
]
```

buildTree should produce:

- Node 1 as a root
- Node 2 as a child of Node 1

### Starting Code

**`src/hooks/useTaskPolling.ts` (export the function):**

```typescript
// Before: function buildTree(...)
export function buildTree(tasks: Task[]): TaskNode[] {
  // ...existing code
}
```

**`src/hooks/useTaskPolling.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest'
import { buildTree } from './useTaskPolling'
import type { Task } from '@/types/task'

// ❌ Create a factory function to build mock tasks
function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-' + Math.random().toString(36).slice(2, 9),
    name: 'Test Task',
    status: 'pending',
    agentType: 'claude',
    parentId: null,
    createdAt: new Date().toISOString(),
    progressPercentage: 0,
    logs: [],
    ...overrides,
  }
}

describe('buildTree', () => {
  it('creates a single root for a task with no parentId', () => {
    // TODO: Create a mock task with parentId: null
    // TODO: Call buildTree([mockTask])
    // TODO: Assert tree.length === 1
    // TODO: Assert tree[0].id === mockTask.id
  })

  it('creates parent-child relationships based on parentId', () => {
    // TODO: Create parent task (id='parent-1', parentId: null)
    // TODO: Create child task (id='child-1', parentId: 'parent-1')
    // TODO: Create grandchild task (id='grandchild-1', parentId: 'child-1')
    // TODO: Call buildTree([parent, child, grandchild])
    // TODO: Assert tree[0] is the parent (tree.length === 1)
    // TODO: Assert tree[0].children[0] is the child
    // TODO: Assert tree[0].children[0].children[0] is the grandchild
  })

  it('treats orphaned children as roots', () => {
    // TODO: Create a task with parentId: 'non-existent-parent'
    // TODO: Call buildTree([orphanedTask])
    // TODO: Assert it's treated as a root (tree.length === 1)
  })
})
```

**Questions to answer:**

- Why export buildTree instead of leaving it internal?
- Why use a factory function `createMockTask()` instead of hardcoding the mock?
- What happens if a child's parentId doesn't exist in the task list?

---

## Challenge 4: Test TaskTree Rendering

**File:** `src/components/TaskTree.test.tsx` (new file)

**Problem:** We need to verify that TaskTree **visually renders** the tree correctly, showing parent
tasks and their children indented beneath them.

**Your Task:**

1. Create tests for TaskTree component rendering
2. **Test 4a:** Single task with no children renders as a single row
3. **Test 4b:** Parent task with children renders parent first, then children indented
4. **Test 4c:** Connector line appears between parent and children
5. **Test 4d:** onStatusChange callback fires when a child's status changes

### Hint

Use `render()` from @testing-library/react to render the component. Use `screen.getByText()` or
`screen.getByRole()` to query the rendered output. Check for DOM structure using `within()` and
check classes for indentation (`pl-6`).

### Starting Code

**`src/components/TaskTree.test.tsx`:**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TaskTree } from './TaskTree'
import type { TaskNode } from '@/types/task'

// ❌ Create a factory for mock TaskNodes
function createMockNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'node-' + Math.random().toString(36).slice(2, 9),
    name: 'Test Node',
    status: 'pending',
    agentType: 'claude',
    parentId: null,
    createdAt: new Date().toISOString(),
    progressPercentage: 0,
    logs: [],
    children: [],
    ...overrides,
  }
}

describe('TaskTree', () => {
  it('renders a single task with no children', () => {
    // TODO: Create one mock node with no children
    // TODO: Render <TaskTree nodes={[mockNode]} />
    // TODO: Assert the node's name appears in the document
    // TODO: Assert TaskCard is rendered (check for class or role)
  })

  it('renders parent and child tasks with indentation', () => {
    // TODO: Create a parent node
    // TODO: Create a child node with parentId matching parent.id
    // TODO: Set parent.children = [child]
    // TODO: Render <TaskTree nodes={[parent]} />
    // TODO: Assert parent name appears first
    // TODO: Assert child name appears after parent
    // TODO: Assert child is inside a div with class "pl-6" (indentation)
  })

  it('renders connector line between parent and children', () => {
    // TODO: Create parent with one child
    // TODO: Render <TaskTree nodes={[parent]} />
    // TODO: Query for the connector line (div with class containing "bg-white/10")
    // TODO: Assert it exists
  })

  it('calls onStatusChange when child status is updated', () => {
    // TODO: Create a mock callback using vi.fn()
    // TODO: Create parent with one child
    // TODO: Render <TaskTree nodes={[parent]} onStatusChange={mockCallback} />
    // TODO: Within the child's TaskCard, find and click a status button
    // TODO: Assert mockCallback was called with correct taskId and status
  })

  it('renders multiple levels of nesting (grandchildren)', () => {
    // TODO: Create grandparent, parent, child nodes
    // TODO: Set grandparent.children = [parent]
    // TODO: Set parent.children = [child]
    // TODO: Render <TaskTree nodes={[grandparent]} />
    // TODO: Assert all three appear in the document
    // TODO: Assert nesting depth increases (use data-testid or check pl-6, pl-12, etc.)
  })
})
```

**Questions to answer:**

- Why use `within()` when querying for elements in a specific part of the tree?
- What's the difference between `getByText()` and `queryByText()`?
- Why is `vi.fn()` used for the mock callback?

---

## Full Solutions

### ✓ Challenge 1: Install Testing Dependencies

**Run these commands:**

```bash
bun add --save-dev vitest @testing-library/react @testing-library/dom jsdom @vitest/ui
```

**Update `package.json`:**

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:watch": "vitest --watch"
  }
}
```

**Key points:**

- `vitest` — fast test runner (uses esbuild, not Babel)
- `@testing-library/react` — utilities for rendering React and querying DOM
- `jsdom` — simulates a browser DOM in Node.js
- `@vitest/ui` — optional visual test dashboard (very helpful!)

---

### ✓ Challenge 2: Configure vitest

**Create `vitest.config.ts`:**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    ui: true,
  },
})
```

**Key points:**

- `environment: 'jsdom'` — provides a fake DOM (needed for @testing-library/react)
- `globals: true` — lets you use `describe`, `it`, `expect` without imports
- `plugins: [react(), tsconfigPaths()]` — handles JSX transform and path aliases
  like `@/components`
- Vitest auto-discovers `.test.ts` and `.test.tsx` files

---

### ✓ Challenge 3: Test buildTree Logic

**Export `buildTree` in `src/hooks/useTaskPolling.ts`:**

```typescript
export function buildTree(tasks: Task[]): TaskNode[] {
  const map = new Map<string, TaskNode>()
  const roots: TaskNode[] = []

  for (const task of tasks) {
    map.set(task.id, { ...task, children: [] })
  }

  for (const node of map.values()) {
    if (node.parentId) {
      const parent = map.get(node.parentId)
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    } else {
      roots.push(node)
    }
  }

  return roots
}
```

**Create `src/hooks/useTaskPolling.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest'
import { buildTree } from './useTaskPolling'
import type { Task } from '@/types/task'

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-' + Math.random().toString(36).slice(2, 9),
    name: 'Test Task',
    status: 'pending',
    agentType: 'claude',
    parentId: null,
    createdAt: new Date().toISOString(),
    progressPercentage: 0,
    logs: [],
    ...overrides,
  }
}

describe('buildTree', () => {
  it('creates a single root for a task with no parentId', () => {
    const parent = createMockTask({ id: 'parent-1' })
    const tree = buildTree([parent])

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('parent-1')
    expect(tree[0].children).toHaveLength(0)
  })

  it('creates parent-child relationships based on parentId', () => {
    const parent = createMockTask({ id: 'parent-1', parentId: null })
    const child = createMockTask({ id: 'child-1', parentId: 'parent-1' })
    const grandchild = createMockTask({ id: 'grandchild-1', parentId: 'child-1' })

    const tree = buildTree([parent, child, grandchild])

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('parent-1')
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].id).toBe('child-1')
    expect(tree[0].children[0].children).toHaveLength(1)
    expect(tree[0].children[0].children[0].id).toBe('grandchild-1')
  })

  it('treats orphaned children as roots', () => {
    const orphan = createMockTask({ id: 'orphan-1', parentId: 'non-existent-parent' })
    const tree = buildTree([orphan])

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('orphan-1')
  })

  it('handles multiple independent trees', () => {
    const tree1Parent = createMockTask({ id: 'tree1-parent', parentId: null })
    const tree1Child = createMockTask({ id: 'tree1-child', parentId: 'tree1-parent' })
    const tree2Parent = createMockTask({ id: 'tree2-parent', parentId: null })

    const tree = buildTree([tree1Parent, tree1Child, tree2Parent])

    expect(tree).toHaveLength(2)
    expect(tree[0].id).toBe('tree1-parent')
    expect(tree[0].children).toHaveLength(1)
    expect(tree[1].id).toBe('tree2-parent')
    expect(tree[1].children).toHaveLength(0)
  })
})
```

**Key points:**

- Factory function `createMockTask()` generates unique IDs and defaults
- Each test is focused on one behavior (single responsibility)
- Assertions check both structure (parent exists) and relationships (child is inside parent)
- Test names are descriptive (future you will thank you)

---

### ✓ Challenge 4: Test TaskTree Rendering

**Create `src/components/TaskTree.test.tsx`:**

```typescript
import { vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@testing-library/react'
import { TaskTree } from './TaskTree'
import type { TaskNode } from '@/types/task'

function createMockNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'node-' + Math.random().toString(36).slice(2, 9),
    name: 'Test Node',
    status: 'pending',
    agentType: 'claude',
    parentId: null,
    createdAt: new Date().toISOString(),
    progressPercentage: 0,
    logs: [],
    children: [],
    ...overrides,
  }
}

describe('TaskTree', () => {
  it('renders a single task with no children', () => {
    const node = createMockNode({ id: 'task-1', name: 'Solo Task' })
    render(<TaskTree nodes={[node]} />)

    expect(screen.getByText('Solo Task')).toBeInTheDocument()
  })

  it('renders parent and child tasks with indentation', () => {
    const parent = createMockNode({
      id: 'parent-1',
      name: 'Parent Task',
      children: [
        createMockNode({
          id: 'child-1',
          name: 'Child Task',
          parentId: 'parent-1',
        }),
      ],
    })

    render(<TaskTree nodes={[parent]} />)

    expect(screen.getByRole('heading', { name: 'Parent Task' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Child Task' })).toBeInTheDocument()
    const childContainer = screen.getByRole('heading', { name: 'Child Task' }).closest('.pl-6')
    expect(childContainer).toBeInTheDocument()
  })

  it('renders connector line between parent and children', () => {
    const parent = createMockNode({
      id: 'parent-1',
      name: 'Parent',
      children: [
        createMockNode({ id: 'child-1', name: 'Child', parentId: 'parent-1' }),
      ],
    })

    const { container } = render(<TaskTree nodes={[parent]} />)

    // Look for the vertical connector line (div with bg-white/10)
    const connector = container.querySelector('.bg-white\\/10')

    expect(connector).toBeInTheDocument()
    expect(connector).toHaveClass('w-px') // vertical line
  })

  it('calls onStatusChange when child status is updated', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response)

    const mockStatusChange = vi.fn()
    const childNode = createMockNode({
      id: 'childNode',
      name: 'Child Task',
      parentId: 'parentNode',
      status: 'pending',
    })
    const parentNode = createMockNode({
      id: 'parentNode',
      name: 'Parent Task',
      children: [childNode],
    })

    const user = userEvent.setup()
    render(<TaskTree nodes={[parentNode]} onStatusChange={mockStatusChange} />)

    // Find the child's cancel button and click it
    const childHeading = screen.getByRole('heading', { name: childNode.name })
    const childContainer = childHeading.closest('.relative') || document.body
    const button = within(childContainer).getByRole('button', { name: /cancel/i })
    await user.click(button)

    expect(mockStatusChange).toHaveBeenCalled()
  })

  it('renders multiple levels of nesting (grandchildren)', () => {
    const grandchildNode = createMockNode({
      id: 'grandchildNode',
      name: 'Grandchild Task',
      parentId: 'childNode'
    })
    const childNode = createMockNode({
      id: 'childNode',
      name: 'Child Task',
      parentId: 'parentNode',
      children: [grandchildNode]
    })
    const parentNode = createMockNode({
      id: 'parentNode',
      name: 'Parent Task',
      children: [childNode],
    })

    render(<TaskTree nodes={[parentNode]} />)

    expect(screen.getByRole('heading', { name: parentNode.name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: childNode.name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: grandchildNode.name })).toBeInTheDocument()
  })
})
```

**Key points:**

- `render()` renders the component into a fake DOM
- `screen.getByText()` queries by visible text (great for accessibility)
- `container.querySelector()` for more precise DOM inspection
- `vi.fn()` creates a mock function to track calls
- Each test focuses on one visual behavior

---

## Testing Checklist

After implementing all four challenges:

- [ ] Vitest installed and configured
- [ ] `bun test` runs without errors
- [ ] `bun test:ui` opens the test dashboard
- [ ] buildTree tests pass (single root, parent-child, orphaned, multiple trees)
- [ ] TaskTree renders single tasks
- [ ] TaskTree renders parent with children
- [ ] Child tasks are indented (pl-6 class)
- [ ] Connector line appears between parent and children
- [ ] Multiple nesting levels work
- [ ] Empty nodes array returns null

---

## Debugging Tips

**Tests won't run?**

- Check that vitest is installed: `bun pm list | grep vitest`
- Verify `vitest.config.ts` exists at project root
- Check for TypeScript errors: `bun tsc --noEmit`

**Render doesn't work (jsdom error)?**

- Ensure `environment: 'jsdom'` in vitest.config.ts
- Verify `jsdom` is installed: `bun pm list | grep jsdom`

**Queries return null?**

- Use `screen.debug()` to print the rendered DOM
- Check that you're querying for the right text (exact match, case-sensitive)
- Use `queryByText()` instead of `getByText()` if element might not exist

**Tests time out?**

- Check for infinite loops in components (React.StrictMode in tests can catch these)
- Look for missing `await` in async queries

**Snapshot tests failing?**

- Don't use snapshot tests for this project (they're fragile)
- Use specific assertions instead (`expect(el).toHaveClass('...')`)

---

## Key Takeaways

1. **Testing pyramid:** Write many unit tests (buildTree logic), fewer integration tests
2. (TaskTree rendering), fewer E2E tests
3. **Factory functions:** Create mock data factories for consistency and readability
4. **Accessibility-first:** Use `screen.getByRole()` and `screen.getByText()` (they follow
   a11y best practices)
5. **One assertion per concept:** Don't cram unrelated assertions into one test
6. **Test behavior, not implementation:** Test "parent shows with children," not "map.get()
   returns correct node"
7. **Vitest for speed:** Vitest is significantly faster than Jest for modern
   projects using ES modules

**The pattern:**

```
Arrange (create mock data) → Act (render component) → Assert (check output)
```

Remember: tests are documentation. They tell future you (and your team) how the code
is *supposed* to work.

Good luck! 🎬
