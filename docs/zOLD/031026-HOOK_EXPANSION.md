# Hook Expansion: Complete Claude Code Event Coverage

> **Added**: 2026-03-10
> **Status**: Complete — 19/19 hooks registered (18 Claude Code events + PostToolUseFailure)

---

## Background

Claude Code exposes 18 lifecycle hook types. The dashboard originally handled 12.
This document records the full hook expansion to all 18, plus the AgentId PATCH fix.

---

## Complete Hook Inventory

| Event | Emoji | Key Payload Fields | Status |
|-------|-------|-------------------|--------|
| `UserPromptSubmit` | 💬 | `.prompt` | ✅ pre-existing |
| `SessionStart` | 🚀 | `.model` | ✅ pre-existing |
| `Stop` | 🛑 | — | ✅ pre-existing |
| `SubagentStart` | 🟢 | `.agent_id`, `.agent_type` | ✅ pre-existing |
| `SubagentStop` | 👥 | `.agent_id`, `.agent_type` | ✅ pre-existing |
| `Notification` | 🔔 | `.message`, `.notification_type` | ✅ pre-existing |
| `PermissionRequest` | 🔐 | `.tool_name` | ✅ pre-existing |
| `PreCompact` | 📦 | `.token_count` | ✅ pre-existing |
| `PostToolUseFailure` | ❌ | `.tool_name`, `.error` | ✅ pre-existing |
| `SessionEnd` | 🏁 | `.reason` | ✅ added 2026-03-10 |
| `TeammateIdle` | 😴 | `.agent_id`, `.agent_type` | ✅ added 2026-03-10 |
| `TaskCompleted` | ✅ | `.task_title`, `.task_id` | ✅ added 2026-03-10 |
| `InstructionsLoaded` | 📋 | `.file_path`, `.source` | ✅ added 2026-03-10 |
| `ConfigChange` | ⚙️ | `.file_path`, `.source` | ✅ added 2026-03-10 |
| `WorktreeCreate` | 🌿 | `.branch`, `.path` | ✅ added 2026-03-10 |
| `WorktreeRemove` | 🍂 | `.branch`, `.path` | ✅ added 2026-03-10 |

> **Notes on agent team events**: `TeammateIdle` and `TaskCompleted` require
> `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json` env block.
> They are registered but won't fire until agent teams are enabled.

---

## Files Modified

### `scripts/session-event.sh`

Added 7 new `case` branches to the event dispatcher (after `PostToolUseFailure`).
Each branch:

1. Extracts relevant fields with `jq -r`
2. Builds a human-readable `SUMMARY` string
3. Sets `EXTRA_FIELDS` JSON object for the session event record

The `*` catch-all still handles any undocumented future events gracefully.

### `~/.claude/settings.json`

Added 7 new hook registrations. All route to `session-event.sh --event-type <EventName>`.
`WorktreeCreate` and `WorktreeRemove` have no `matcher` support (confirmed in Claude docs).

### `src/types/task.ts`

Extended `SessionEventType` union with 7 new string literals.

Added optional fields to `SessionEvent` interface:

- `reason?` — from `SessionEnd`
- `taskTitle?` — from `TaskCompleted`
- `filePath?` — from `InstructionsLoaded` / `ConfigChange`
- `source?` — from `InstructionsLoaded` / `ConfigChange`
- `branch?` — from `WorktreeCreate` / `WorktreeRemove`

### `src/components/TaskTable.tsx`

Added 7 entries to `SESSION_EVENT_EMOJI` map. TypeScript's exhaustive `Record<SessionEventType>`
type ensures the compiler will catch any future missing entries.

---

## AgentId PATCH Fix (same session)

**Problem**: The task table's Agent ID column showed `toolu_*` (the tool use ID),
while session events showed a short hex string like `acbdbf5a94d625cc`. These are
two completely different fields.

**Root cause**: Two distinct IDs exist in Claude Code hooks:

- `.tool_use_id` — identifies the `Agent` tool call in the parent session's transcript.
  This becomes `task.id` when `pre-tool-agent.sh` creates the task record.
- `.agent_id` — the subagent's own identity, reported in `SubagentStart` / `SubagentStop`
  session events.

**Fix**: `SubagentStart` now PATCHes the task record with the real `.agent_id`:

1. `pre-tool-agent.sh` writes `TASK_ID` to `/tmp/cc-agent-task-$SAFE_SID`
2. `session-event.sh` (SubagentStart) reads that temp file
3. If empty (race condition — hooks run concurrently), falls back to querying
   json-server for the most recent task in the session
4. PATCHes `{ agentId: <real-agent-id> }` onto the task record

**Verified working**:

```
[16:35:15] [session] INFO: SubagentStart — temp file empty, looked up most recent task: toolu_01PTVP8...
[16:35:15] [session] INFO: patched task toolu_01PTVP8... with agentId=acbdbf5a94d625cc (HTTP 200)
```

The task table Agent ID column now shows the short hex ID that matches
the GlobalEventStrip session events, enabling accurate pause/stop targeting.

---

## Triggering the New Events

| Event | How to trigger |
|-------|---------------|
| `SessionEnd` | Exit a Claude Code session (`/exit` or close terminal) |
| `InstructionsLoaded` | Start a fresh session — CLAUDE.md loads on startup |
| `ConfigChange` | Edit `~/.claude/settings.json` mid-session |
| `WorktreeCreate` | Use `isolation: "worktree"` in an Agent tool call |
| `WorktreeRemove` | After a worktree Agent call completes with no changes |
| `TeammateIdle` | Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| `TaskCompleted` | Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
