# Session events strip

A collapsible panel above the task views listing session-level Claude Code events
(UserPromptSubmit, SessionStart, SubagentStart, etc.) fetched from `/api/sessionEvents`.

## Sub-features

- `events.collapse` — expand/collapse the strip.
- `events.clear` — "Clear all" removes stored session events.
- `events.list` — events render with emoji and timestamp.

## How to get to it (user POV)

1. Open the dashboard at `/`.
2. Find the session events header (collapsed by default in some states).
3. Click **Expand session events** (`aria-label` matching `/expand session events/i`).
4. Optionally click **Clear all** when events are present.

## Driving it with cursor-ide-browser

Preconditions: running instance; optional seed via `POST /api/sessionEvents` or a
live hook firing `session-event.sh`.

- **Expand** — click expand control, snapshot must list event rows or empty copy.
- **Collapse** — click collapse control, snapshot shows collapsed state.
- **Clear** — with events present, click clear, `curl /api/sessionEvents` returns `[]`.

## Gotchas

- Clearing is destructive — only do it on disposable verify instances.
- Event text comes from hook payloads; without hooks, the strip may be empty.
