# Architecture Upgrade — Four Gaps & Implementation Roadmap

## The Problem

The dashboard currently shows WHAT tasks ran and whether they succeeded. What it can't show
yet is:

1. **What agents reported back** — `SubagentStop.last_assistant_message` exists in the hook
   payload but is silently discarded
2. **Which skill triggered the chain** — when a user runs `/skill-name`, there's no attribution
   on the spawned tasks
3. **What agents did internally** — Bash/Read/WebFetch inside subagents attach to the WRONG
   task because `pre-tool-all.sh` looks up tasks by `sessionId`, which is shared by all agents
4. **Self-evaluation vs. work** — code-reviewer subagents look identical to implementation
   agents

## Solution: Four-Phase Upgrade

The phases build on each other. Each phase adds one capability and is independently valuable.
Use json-server throughout — SQLite migration is deferred until the feature set is validated.

---

## Phase 1: Surface Agent Final Messages (Highest Priority)

**Capability**: When agents finish, see their final summary.

**Why first**: Pure additive, zero risk. Agents already generate this content via
`SubagentStop.last_assistant_message` — we're just dropping it and need to capture it.

### Hook Script Changes: `scripts/post-tool-agent.sh`

After the `IS_ERROR` extraction (line 33), extract the final message:

```bash
LAST_MSG=$(echo "$INPUT" | jq -r '
  (.tool_response // .tool_result // {}) |
  .last_assistant_message // empty
')
```

In the `UPDATED` jq block (lines 90–102), merge this field:

```bash
--arg last_msg "$LAST_MSG" \
'
  . + {
    status: $status,
    completedAt: $now,
    progressPercentage: $progress,
    logs: (.logs + [$newlog]),
    sessionId: (if $sessionId != "" then $sessionId else .sessionId end),
    lastAssistantMessage: (if $last_msg != "" then $last_msg else .lastAssistantMessage end)
  }
'
```

In the FALLBACK task creation (lines 120–139), include:

```bash
--arg last_msg "$LAST_MSG" \
'
  {
    id: $id,
    name: $name,
    status: $status,
    agentType: $agent,
    parentId: null,
    createdAt: $now,
    startedAt: $now,
    completedAt: (if $status == "running" then null else $now end),
    progressPercentage: $progress,
    logs: [$log],
    lastAssistantMessage: (if $last_msg != "" then $last_msg else null end)
  }
'
```

### TypeScript Changes: `src/types/task.ts`

Add to the `Task` interface:

```typescript
lastAssistantMessage?: string  // final summary from SubagentStop payload
```

### React Changes: `src/components/TaskTable.tsx`

Create an `AgentSummaryRow` component (modeled on `EventTrailRow` at lines 459–514):

```tsx
function AgentSummaryRow({ task }: { task: TaskNode }) {
  if (!task.lastAssistantMessage) return null
  return (
    <TableRow className="bg-stone-950/50">
      <TableCell colSpan={8} className="border-t border-stone-800 p-0">
        <div className="space-y-2">
          <div className="px-3 pt-3 font-mono text-[10px] font-bold uppercase tracking-widest
            text-stone-500">
            Agent Summary
          </div>
          <div className="whitespace-pre-wrap p-3 font-mono text-[11px] text-stone-300">
            {task.lastAssistantMessage}
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}
```

Render it in the detail panel (where `LogDetailRow` and `EventTrailRow` are rendered):

```tsx
{expandedLogs.has(task.id) && (
  <>
    {/* existing EventTrailRow, LogDetailRow ... */}
    <AgentSummaryRow task={task} />
  </>
)}
```

---

## Phase 2: Skill Attribution (Beat 1 + Beat 2)

**Capability**: Every task shows which `/skill-name` command started the workflow chain.

**Why here**: Connects user intent (the `/` command) to task execution. Creates a clear audit
trail: "this skill spawned these tasks."

### Hook Script Changes: `scripts/session-event.sh`

In the `UserPromptSubmit` case handler (lines 60–64), after extracting `PROMPT`, detect and
track skills:

```bash
SKILL=""
if [[ "$PROMPT" == /* ]]; then
  SKILL=$(echo "$PROMPT" | grep -oE '^/[^ ]+' | head -1)
fi

if [ -n "$SKILL" ]; then
  EXTRA_FIELDS=$(jq -n --arg skill "$SKILL" '{ originatingSkill: $skill }')
  SAFE_SID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
  echo "$SKILL" > "/tmp/cc-skill-$SAFE_SID"
else
  EXTRA_FIELDS="{}"
fi
```

In the `Stop` case handler (lines 71–73), clean up the temp file:

```bash
Stop)
  SAFE_SID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
  rm -f "/tmp/cc-skill-$SAFE_SID"
  SUMMARY="session ended"
  EXTRA_FIELDS="{}"
  ;;
```

### Hook Script Changes: `scripts/pre-tool-agent.sh`

When creating new tasks, read the skill that started the session and propagate it. After the
`DEPENDENCIES` extraction block (lines 42–51), add:

```bash
# Read the originating skill (if this session started with /skill-name)
SAFE_SID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
SKILL_FILE="/tmp/cc-skill-$SAFE_SID"
ORIGINATING_SKILL=""
if [ -f "$SKILL_FILE" ]; then
  ORIGINATING_SKILL=$(cat "$SKILL_FILE" | tr -cd 'a-zA-Z0-9/_-')
fi
```

Add the skill to the task creation payload:

```bash
--arg skill "$ORIGINATING_SKILL" \
'
  {
    id: $id,
    name: $name,
    status: "running",
    agentType: $agent,
    parentId: (if $parentId == "" then null else $parentId end),
    sessionId: (if $sessionId == "" then null else $sessionId end),
    createdAt: $now,
    startedAt: $now,
    completedAt: null,
    progressPercentage: 0,
    logs: [
      { timestamp: $now, level: "info", message: ("Task started: " + $name) }
    ],
    events: [],
    dependencies: $dependencies,
    originatingSkill: (if $skill != "" then $skill else null end)
  }
'
```

### TypeScript Changes: `src/types/task.ts`

Add fields to both interfaces:

```typescript
export interface SessionEvent {
  // ... existing fields ...
  originatingSkill?: string  // /skill-name detected in UserPromptSubmit
}

export interface Task {
  // ... existing fields ...
  originatingSkill?: string  // skill that spawned this task's session
}
```

### React Changes: `src/components/TaskTable.tsx`

**GlobalEventStrip** — Show skill pills in the session event list. In the events map block
(around line 558), after the summary span, conditionally render a skill badge:

```tsx
{event.type === 'UserPromptSubmit' && event.originatingSkill && (
  <span className="shrink-0 rounded bg-violet-950 px-1.5 py-0.5 font-mono text-[10px]
    text-violet-300 border border-violet-700">
    {event.originatingSkill}
  </span>
)}
```

**TaskRow** — Add a tooltip to the task name showing which skill started the session:

```tsx
<span
  className="truncate font-medium text-stone-100"
  title={task.originatingSkill ? `initiated by ${task.originatingSkill}` : undefined}
>
  {task.name}
</span>
```

---

## Phase 3: Internal Agent Tool Trace

**Capability**: See all tool calls (Bash, Read, WebFetch) that happened inside a subagent,
correctly attributed to the right task.

**Why here**: Requires fixing the multi-agent bug in `pre-tool-all.sh` and `post-tool-all.sh`
(they currently use `sessionId` which breaks when multiple agents share a session). This
phase unlocks the event trail visibility.

### The Root Cause

`pre-tool-all.sh` lines 56–65 and `post-tool-all.sh` lines 46–51 do:

```bash
curl -s "http://localhost:3001/tasks?status=running&sessionId=$SESSION_ID"
```

This returns **all** running tasks for that session. In a multi-agent session, multiple agents
are running simultaneously, so `.tasks[0]` picks an arbitrary task. The correct approach: use
`agent_id` from the hook payload, which is present and equals the `tool_use_id` that created
the task.

### Hook Script Changes: `scripts/pre-tool-all.sh`

After `SESSION_ID` extraction (line 25), add:

```bash
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')
```

Replace lines 56–65 with a two-path lookup:

```bash
if [ -n "$AGENT_ID" ]; then
  # Direct lookup: agent_id == tool_use_id == task.id in pre-tool-agent.sh
  TASK=$(curl -s "http://localhost:3001/tasks/$AGENT_ID")
  LOOKUP_METHOD="agent_id"
else
  # Fallback for main-session tool calls (no subagent context)
  TASK=$(curl -s "http://localhost:3001/tasks?status=running&sessionId=$SESSION_ID" | jq '.[0]')
  LOOKUP_METHOD="sessionId"
fi

# Verify lookup succeeded
if ! echo "$TASK" | jq -e '.id' > /dev/null 2>&1; then
  log "WARN: no running task found for $TASK_ID [via $LOOKUP_METHOD]"
  exit 0  # Continue without error; event will be lost but won't crash the hook
fi

TASK_ID=$(echo "$TASK" | jq -r '.id')
```

Update the log message to show which lookup method was used:

```bash
log "OK: appended event to task $TASK_ID ($TOOL_NAME) [via $LOOKUP_METHOD]"
```

### Hook Script Changes: `scripts/post-tool-all.sh`

Same two-path fix. After `SESSION_ID` extraction (line 24), add:

```bash
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty')
```

Replace lines 46–51 with:

```bash
if [ -n "$AGENT_ID" ]; then
  TASK=$(curl -s "http://localhost:3001/tasks/$AGENT_ID")
  LOOKUP_METHOD="agent_id"
else
  # For sessionId-based lookup, filter for running or paused status
  TASK=$(curl -s "http://localhost:3001/tasks?sessionId=$SESSION_ID" | jq '
    .[] | select(.status == "running" or .status == "paused") | . | first
  ')
  LOOKUP_METHOD="sessionId"
fi
```

### No TypeScript or React changes needed — this phase fixes the bug

The existing `EventTrailRow` component (lines 459–514) already renders `task.events[]` with
full event details. Once the attribution bug is fixed, the trace becomes accurate automatically.

---

## Phase 4: Self-Evaluation Labeling (fold into Phase 3)

**Capability**: Distinguish evaluation/planning subagents from work subagents in the UI.

**Why here**: Adds semantic meaning to the task tree. Helps trace which parts of the workflow
are "creative work" vs. "quality review."

### Hook Script Changes: `scripts/pre-tool-agent.sh`

After the `DEPENDENCIES` extraction block (lines 42–51), add task kind detection:

```bash
# Detect evaluation/planning vs. work tasks
KIND_TAG=$(echo "$TASK_NAME" | grep -oE '\[kind:[^]]+\]' || true)
if [ -n "$KIND_TAG" ]; then
  TASK_KIND=$(echo "$KIND_TAG" | sed 's/\[kind://;s/\]//')
  TASK_NAME=$(echo "$TASK_NAME" | sed 's/ \[kind:[^]]*\]//' | sed 's/\[kind:[^]]*\] //' | sed 's/\[kind:[^]]*\]//')
else
  # Infer from subagent type
  case "$SUBAGENT_TYPE" in
    *code-reviewer*|*reviewer*)
      TASK_KIND="evaluation" ;;
    *architect*|*planner*|*Plan*)
      TASK_KIND="planning" ;;
    *)
      TASK_KIND="work" ;;
  esac
fi
```

Add `--arg kind "$TASK_KIND"` and include in the task JSON:

```bash
'
  {
    ...
    taskKind: $kind
  }
'
```

### TypeScript Changes: `src/types/task.ts`

```typescript
export type TaskKind = 'work' | 'evaluation' | 'planning'

export interface Task {
  // ... existing fields ...
  taskKind?: TaskKind
}
```

### React Changes: `src/components/TaskTable.tsx`

Import Tabler icons:

```typescript
import { IconMicroscope, IconRuler } from '@tabler/icons-react'
```

Add a constant mapping task kinds to icons:

```typescript
const TASK_KIND_ICON: Record<Exclude<TaskKind, 'work'>, React.ReactNode> = {
  evaluation: <IconMicroscope size={11} className="text-sky-400" />,
  planning:   <IconRuler size={11} className="text-violet-400" />,
}
```

In the task name cell (around line 691), render the icon conditionally:

```tsx
<span className="truncate font-medium text-stone-100">{task.name}</span>
{task.taskKind && task.taskKind !== 'work' && (
  <span className="shrink-0 ml-2">{TASK_KIND_ICON[task.taskKind]}</span>
)}
```

---

## Implementation Checklist

- [ ] Phase 1: Extract `last_assistant_message` in post-tool-agent.sh
  - [ ] Add `LAST_MSG` extraction
  - [ ] Merge into `UPDATED` jq block
  - [ ] Include in `FALLBACK` creation
  - [ ] Add field to `Task` type
  - [ ] Create `AgentSummaryRow` component
  - [ ] Test: agent task → expand log panel → verify summary appears

- [ ] Phase 2: Skill attribution (Beat 1 + 2)
  - [ ] Detect `/` pattern in `UserPromptSubmit` case
  - [ ] Write skill to `/tmp/cc-skill-$SAFE_SID`
  - [ ] Read skill in `pre-tool-agent.sh` on task creation
  - [ ] Clean up temp file in `Stop` case
  - [ ] Add fields to `SessionEvent` and `Task` types
  - [ ] Render skill pill in GlobalEventStrip
  - [ ] Add tooltip to task name
  - [ ] Test: `/skill-name ...` → verify pill in session events, tooltip on tasks

- [ ] Phase 3: Fix multi-agent tool attribution
  - [ ] Extract `agent_id` in pre-tool-all.sh
  - [ ] Implement two-path lookup (agent_id, then fallback to sessionId)
  - [ ] Same fix in post-tool-all.sh
  - [ ] Log which lookup method was used
  - [ ] Test: multi-agent session → verify tool events attach to correct tasks

- [ ] Phase 4: Task kind labeling
  - [ ] Add kind detection in pre-tool-agent.sh
  - [ ] Add `TaskKind` type and field
  - [ ] Import Tabler icons
  - [ ] Add icons to task name cell
  - [ ] Test: code-reviewer agent → verify 🔬 icon appears

---

## Gotchas & Pitfalls

**Phase 1**: The `last_assistant_message` field is present in the hook payload. If it doesn't
appear, check the Claude Code SDK version — there may be a naming change (similar to
`tool_response` → `tool_result`). Add a temporary debug log to inspect the raw payload:
`log "DEBUG: $(echo "$INPUT" | jq -c '.')"`

**Phase 2**: Only the **most recent** skill per session is tracked. If a user runs `/skill-a`
and then `/skill-b` in the same session, tasks spawned after `/skill-b` will be attributed to
`/skill-b`. The `/skill-a` attribution is overwritten. This is acceptable for the MVP.

**Phase 3**: The `agent_id` field is **only present** when the hook fires inside a subagent
context. Main-session tool calls will have an empty `agent_id`, so the fallback to `sessionId`
lookup must remain. Test by running a tool directly in the main session and verifying the
event attaches correctly.

**Phase 4**: The bash `case` statement uses glob matching, not regex. So `*code-reviewer*`
matches `code-reviewer`, `superpowers:code-reviewer`, and `feature-dev:code-reviewer`.

---

## Validation Steps (End-to-End)

### Phase 1

1. Run `bun run dev`
2. Trigger any subagent task (e.g., Explore agent)
3. Wait for completion
4. Expand the log panel
5. Verify "Agent Summary" section appears with the agent's final message

### Phase 2

1. In Claude, type `/some-skill some prompt text`
2. In GlobalEventStrip, find the `UserPromptSubmit` event
3. Verify a violet `/some-skill` pill appears in that row
4. In the task table, hover over a spawned task's name
5. Verify tooltip shows "initiated by /some-skill"

### Phase 3

1. Run a prompt that spawns 2+ parallel subagents (e.g., Explore + Plan running side-by-side)
2. Trigger tool calls in both subagents (Bash, Read, etc.)
3. Expand the event trail for each task
4. Verify tool events appear in the correct task (not mixed)
5. Check `logs/hooks.log` — should see `[via agent_id]` for subagent events,
   not `[via sessionId]`

### Phase 4

1. Invoke a `code-reviewer` subagent
2. Verify a 🔬 icon appears next to that task's name
3. Create a task with `[kind:evaluation]` tag in the description
4. Verify the same icon appears
