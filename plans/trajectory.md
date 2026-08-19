# Trajectory — build plan

Shared understanding reached 2026-08-19. See [CONTEXT.md](../CONTEXT.md) for vocabulary and
[ADR 0001](../docs/adr/0001-trajectory-reads-the-transcript-not-the-hooks.md)
for the data-source decision.

## The six decisions

| | Decision |
| --- | --- |
| Purpose | Debug a single run that went wrong. Not analytics, not compliance. |
| Scope | The Conversation Thread. Turns and Calls are zoom levels, not scopes. |
| Source | The transcript JSONL. Hooks keep feeding the simple view. |
| Access | Parse on demand, project server-side. No index, no polling. |
| Rows | `USER`, `ASSISTANT`, `TOOL`, `CONTEXT`. Noise hidden behind one toggle. |
| Entry | Thread picker sourced from the filesystem, plus a degrading breadcrumb from task rows. |

## Build steps

### 1. `src/lib/parseTranscript.ts` — ~1.5h

The only module that touches Claude Code's raw field names.
Everything downstream sees our types.
This is the containment boundary ADR 0001 depends on.

- List threads: read `~/.claude/projects/<cwd-slug>/*.jsonl`.
  The slug is the absolute cwd with `/` replaced by `-`.
- Parse one thread into rows.
- Pair each `tool_use` with its `tool_result` by `tool_use_id` — one row, not two.
- Group rows by `promptId` into Turns.
- Classify attachments as Context Injection or noise.

Signal (rendered as `CONTEXT`): `hook_additional_context`, `skill_listing`,
`agent_listing_delta`, `deferred_tools_delta`, `command_permissions`.

Noise (hidden unless the toggle is on): `hook_success`, `output_style`, `task_reminder`.

Ignore `thinking` blocks — measured at median 0 characters, they are redacted.

### 2. Three endpoints — ~45min

- `GET /trajectory` — thread list from the filesystem
- `GET /trajectory/:sessionId` — projected rows, roughly 65 KB
- `GET /trajectory/:sessionId/:rowId` — full payload and result for one row

Never ship the raw 3.9 MB to the browser.
Cache the parse by file mtime and size.

### 3. `TrajectoryView.tsx` — ~3h

Port [the mockup](../docs/mockups/trajectory.html), then add what the mockup was missing:
`USER`, `ASSISTANT`, and `CONTEXT` rows, plus Turn gutter markers.

Three zoom levels:

- **Duration** — default. Every row.
- **Turns** — collapse to Turn boundaries with roll-up counts (`… 9 steps · 16 tool calls`).
- **Calls** — Assistant steps visible, Tool Calls rolled up per step.

Toolbar also carries the noise toggle and search. Search is a client-side filter over the
projected rows.

### 4. Wire into Dashboard — ~30min

[Dashboard.tsx](../src/components/Dashboard.tsx) already has
`useState<'table' | 'board'>`. Add `'trajectory'` and a third toolbar button, plus the
thread picker.

### 5. Breadcrumb on task rows — ~45min

A tool-call count chip per task row, amber or red when something failed, counted from
`hook_events` on the dashboard side.

The chip opens `GET /trajectory/:sessionId` at Duration zoom, scrolled to the Turn containing
the task's first `hook_events.timeStamp`, with that Turn's gutter marked.
Duration is forced on arrival so the target cannot land inside a collapsed roll-up.

**The full thread always renders. The marker is a hint, not a filter.**
[CONTEXT.md](../CONTEXT.md) makes the Thread Trajectory's scope, always — and a failed task's
cause is usually upstream of the task itself, so filtering hides the evidence you opened the
view to find.

There is also no key to filter on: `hook_events` has no `toolUseId`, so timestamps are the only
correlation between a task and a transcript row.
Using one to pick a *scroll target* is safe — a wrong match lands you slightly off and you look
around.
Using one to build a view is not — a wrong match hides rows silently, and you never learn what
you missed.
Keep the comparison in the component; ADR 0001 wants `parseTranscript.ts` thin.

Shown only when `sessions.id` matches a transcript filename; absent otherwise, with no
error state. If no Turn resolves, the link opens the thread at the top.

### 6. Fix the dead health check — 5min

Unrelated to Trajectory but real: `${API_BASE}/api/tasks` should be `${API_BASE}/tasks` in
`scripts/pre-tool-all.ts` and `scripts/post-tool-all.ts`.
`hook_events` currently has 0 rows because of it. GitHub issue #57.

**Total: roughly 6.5 hours.**

## Explicitly out of scope

- Cross-thread search and aggregate pattern-hunting. A different feature; option (b) in Q1.
  Adding it later means adding an index, which does not undo anything decided here.
- Payload caps and retention policy. Dissolved — we do not copy payloads anywhere.
- The planned `hook_events` schema change (nullable `taskId`, added `sessionId`, `payload`,
  `result`). Dissolved by ADR 0001.
- Live polling of Trajectory. It is a diagnostic opened after the fact, not a monitor.

## What this design does *not* invalidate

`src/server.ts` carries a `TODO(human)` to attach `hook_events` to `GET /tasks` (issue #59).
ADR 0001 says Trajectory does not need `hook_events` — it does **not** say nothing needs them.
The simple view still renders an event trail, and that still requires the JOIN.
Keep the TODO and keep the issue; it is now a simple-view concern, not a Trajectory one.

Until the JOIN lands, `GET /tasks` returns no `events` field, so `pre-tool-all.ts` reads
`undefined` and PATCHes a one-element array on every call, and `post-tool-all.ts` can never
locate the pre-event it is meant to complete.
The pre/post pairing is broken, not merely empty.

The three plans in `plans/001`–`003` are likewise unaffected by ADR 0001 and remain valid
as written.
