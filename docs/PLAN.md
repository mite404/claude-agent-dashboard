# Claude Agent Dashboard - Implementation Plan

## Overview
A real-time web dashboard for tracking Claude Code subagent task execution. The dashboard polls a local JSON file (updated via a Claude Code hook) and displays task status, relationships, logs, and provides control buttons (cancel/pause/retry).

**Tech Stack**: Bun + React + Tailwind + shadcn/ui + Radix UI

---

## Phase 1: Project Setup & Infrastructure

### 1.1 Install Dependencies
```bash
bun install
```

**Files Modified**: `package.json` (already done)

### 1.2 Create Core Project Structure

Create the following directory structure:
```
claude-agent-dashboard/
├── src/
│   ├── components/
│   │   ├── TaskCard.tsx          # Individual task display
│   │   ├── TaskTree.tsx          # Hierarchical task relationships
│   │   ├── LogViewer.tsx         # Accordion-style log viewer
│   │   ├── ControlButtons.tsx    # Cancel/Pause/Retry buttons
│   │   └── Dashboard.tsx         # Main dashboard container
│   ├── types/
│   │   └── task.ts              # TypeScript interfaces for tasks
│   ├── hooks/
│   │   └── useTaskPolling.ts    # Hook for polling /tmp/claude-tasks.json
│   ├── utils/
│   │   └── taskParser.ts        # Parse /tasks CLI output
│   ├── styles/
│   │   ├── globals.css          # Global styles + Tailwind
│   │   └── variables.css        # CSS variables for theming
│   └── frontend.tsx             # React app entry point
├── public/
│   └── index.html               # HTML template
├── index.ts                     # Bun server entry point
├── tailwind.config.ts           # Tailwind configuration
├── postcss.config.js            # PostCSS configuration
├── tsconfig.json                # Already created
└── docs/
    ├── PLAN.md                  # This file
    ├── HOOK.md                  # Hook setup instructions
    └── API.md                   # Data format specification
```

### 1.3 Configure Tailwind
**File**: `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}', './public/**/*.html'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
```

### 1.4 Configure PostCSS
**File**: `postcss.config.js`

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

### 1.5 Create Global Styles
**File**: `src/styles/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.6%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 3.6%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 96.1%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 89.5%;
  --muted-foreground: 0 0% 45.9%;
  --accent: 0 84.2% 60.2%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 100%;
  --border: 0 0% 89.5%;
  --input: 0 0% 89.5%;
  --ring: 0 0% 9%;
  --radius: 0.5rem;
}

* {
  @apply border-border;
}

body {
  @apply bg-background text-foreground;
}
```

---

## Phase 2: Type Definitions & Interfaces

### 2.1 Define Task Type
**File**: `src/types/task.ts`

```typescript
export interface Task {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  parentTaskId?: string;
  childTaskIds: string[];
  createdAt: number; // timestamp
  startedAt?: number;
  completedAt?: number;
  progressPercentage: number; // 0-100
  logs: string[];
}

export interface TasksState {
  tasks: Record<string, Task>;
  lastUpdated: number;
}
```

### 2.2 Create Task Parser Utility
**File**: `src/utils/taskParser.ts`

This utility parses the `/tasks` CLI output and converts it into our `Task` interface. Expected to handle:
- Parse text output from `bun run /tasks`
- Extract task ID, status, agent name, timing
- Build parent-child relationships
- Format logs with timestamps

---

## Phase 3: React Components

### 3.1 useTaskPolling Hook
**File**: `src/hooks/useTaskPolling.ts`

```typescript
export function useTaskPolling(interval: number = 2000) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const poll = async () => {
      setLoading(true);
      try {
        // Read from /tmp/claude-tasks.json
        const response = await fetch('/api/tasks');
        const data = await response.json();
        setTasks(data.tasks);
      } catch (error) {
        console.error('Failed to poll tasks:', error);
      } finally {
        setLoading(false);
      }
    };

    const timer = setInterval(poll, interval);
    poll(); // Initial fetch

    return () => clearInterval(timer);
  }, [interval]);

  return { tasks, loading };
}
```

### 3.2 ControlButtons Component
**File**: `src/components/ControlButtons.tsx`

Displays three buttons in order: Cancel | Pause | Retry
- Cancel: POSTs to `/api/tasks/:id/cancel`
- Pause: POSTs to `/api/tasks/:id/pause`
- Retry: POSTs to `/api/tasks/:id/retry`

Uses shadcn button component.

### 3.3 LogViewer Component
**File**: `src/components/LogViewer.tsx`

- Accordion-style display of task logs
- Expandable/collapsible sections
- Syntax highlighting for log entries
- Timestamps for each log entry
- Similar UX to GitHub Actions logs on PRs

Uses Radix UI Accordion component.

### 3.4 TaskCard Component
**File**: `src/components/TaskCard.tsx`

Displays single task with:
- Task ID (small monospace)
- Task name (large)
- Status badge (color-coded)
- Progress bar (0-100%)
- Agent time / Elapsed time
- Expandable log viewer
- Control buttons

Uses shadcn Card component.

### 3.5 TaskTree Component
**File**: `src/components/TaskTree.tsx`

Displays hierarchical relationship between parent and child tasks:
- Parent task at top
- Child tasks indented below
- Connection lines showing relationships
- Recursive rendering

### 3.6 Dashboard Component
**File**: `src/components/Dashboard.tsx`

Main container that:
- Uses `useTaskPolling` hook
- Displays task list/tree
- Shows last update timestamp
- Indicates polling status (loading spinner)
- Handles empty states

---

## Phase 4: Server & Data Synchronization

### 4.1 Bun Server
**File**: `index.ts`

```typescript
import fs from 'fs';
import path from 'path';
import index from './public/index.html';

const TASKS_FILE = '/tmp/claude-tasks.json';

Bun.serve({
  routes: {
    '/': index,
    '/api/tasks': {
      GET: () => {
        try {
          const data = fs.readFileSync(TASKS_FILE, 'utf-8');
          return new Response(data, {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch {
          return new Response(JSON.stringify({ tasks: [] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },
    '/api/tasks/:id/cancel': {
      POST: (req) => {
        // Implementation: send cancel signal to Claude Code
        return new Response(JSON.stringify({ status: 'cancelled' }));
      },
    },
    '/api/tasks/:id/pause': {
      POST: (req) => {
        return new Response(JSON.stringify({ status: 'paused' }));
      },
    },
    '/api/tasks/:id/retry': {
      POST: (req) => {
        return new Response(JSON.stringify({ status: 'retrying' }));
      },
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log('Dashboard available at http://localhost:3000');
```

### 4.2 Create HTML Template
**File**: `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Agent Dashboard</title>
  <link rel="stylesheet" href="../src/styles/globals.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="../src/frontend.tsx"></script>
</body>
</html>
```

### 4.3 React App Entry Point
**File**: `src/frontend.tsx`

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import Dashboard from './components/Dashboard';

const root = createRoot(document.getElementById('root')!);
root.render(<Dashboard />);
```

---

## Phase 5: Claude Code Hook Integration

### 5.1 Create Hook Documentation
**File**: `docs/HOOK.md`

Provide instructions for Claude Code hook setup that:
1. Runs `bun run /tasks` command periodically
2. Parses the output
3. Writes to `/tmp/claude-tasks.json` with enriched metadata
4. Can be triggered via `PostToolUse` hook on Agent tool

Example hook format:
```bash
/tasks | jq 'parse_tasks_output' > /tmp/claude-tasks.json
```

### 5.2 Create Data Format Spec
**File**: `docs/API.md`

Document the expected JSON format in `/tmp/claude-tasks.json`:
```json
{
  "tasks": [
    {
      "id": "task-123",
      "name": "Research API endpoints",
      "status": "running",
      "parentTaskId": null,
      "childTaskIds": ["task-124"],
      "createdAt": 1234567890,
      "startedAt": 1234567891,
      "progressPercentage": 45,
      "logs": [
        "[10:30:45] Starting task...",
        "[10:30:50] Fetching data..."
      ]
    }
  ]
}
```

---

## Phase 6: Testing & Validation

### 6.1 Manual Testing
- [ ] Start server: `bun run dev`
- [ ] Open `http://localhost:3000`
- [ ] Verify Tailwind styles load
- [ ] Verify layout renders without errors

### 6.2 Mock Data Testing
- Create a mock `/tmp/claude-tasks.json` with sample data
- Verify dashboard displays tasks correctly
- Verify polling updates UI

### 6.3 Real Integration Testing
- Set up Claude Code hook
- Run actual subagent tasks
- Verify tasks appear in dashboard
- Test control buttons

---

## Phase 7: Documentation & Polish

### 7.1 Update Root README
Add setup and usage instructions for the dashboard.

### 7.2 Add Component Documentation
Document shadcn/ui components used and customizations.

### 7.3 Performance Optimization
- Memoize components to avoid unnecessary re-renders
- Debounce polling if needed
- Optimize log rendering for large outputs

---

## Verification Criteria

✅ **Phase 1**: Project initializes and Tailwind builds without errors
✅ **Phase 2**: TypeScript compiles with no errors
✅ **Phase 3**: React components render without errors
✅ **Phase 4**: Server starts on `http://localhost:3000`
✅ **Phase 5**: Dashboard correctly reads and displays `/tmp/claude-tasks.json`
✅ **Phase 6**: Polling works every 2-3 seconds
✅ **Phase 7**: Control buttons POST to correct endpoints
✅ **Phase 8**: Logs display in accordion without breaking layout
✅ **Phase 9**: Subagent relationships render hierarchically

---

## Key Decisions

1. **No Backend Complexity**: Using simple file-based state (`/tmp/claude-tasks.json`) instead of a full backend server
2. **React Required**: shadcn/ui requires React, so we're using React despite initial consideration of pure HTML5
3. **File Polling**: Hook writes to a JSON file, dashboard reads periodically—simpler than WebSocket/API
4. **Tailwind + Radix**: shadcn/ui provides pre-built accessible components built on Radix UI
5. **Bun Serving**: Using Bun's built-in server for simplicity—no Express needed

---

## Next Steps for Sonnet

1. Execute Phase 1-2 (Setup, types, utilities)
2. Build Phase 3 (React components)
3. Complete Phase 4 (Server, HTML, entry point)
4. Create hook documentation in Phase 5
5. Test and validate against verification criteria
6. Polish and document
