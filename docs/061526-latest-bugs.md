# Dashboard — Open Issues as of 2026-06-22

---

## ✅ Resolved since last review

| Issue | Resolution |
| ----- | ---------- |
| `hookEventsTable` missing from SQLite schema | Added. PATCH handler now writes hook events. |
| Hook scripts still in bash | All migrated to TypeScript (`.ts`). |
| `post-tool-agent.ts` incomplete (1-line stub) | Fully implemented. |
| `claimedBy` silently dropped on PATCH | Added to `validCols` whitelist in server. |
| `sessionId` optional in `createTask()` but required by backend | Made required in type. |
| Double-click race on "Create Task" button | `creatingTask` boolean guard added. |
| Stale form values when popover dismissed | `onOpenChange` now resets form on close. |

---

## 1. EventTrailRow always renders empty (P1 — real bug)

The `hookEventsTable` schema and PATCH handler are correct, but `GET /tasks` does not JOIN
hook events into the response.
`task.events` arrives as `undefined` in the frontend, so the event trail row is always empty.

**Fix:** In `src/server.ts` `GET /tasks`, fetch all matching `hook_events` using
`inArray(hookEventsTable.taskId, rows.map(r => r.id))` and attach as `events[]` on each task.
A `TODO(human)` placeholder marks the exact insertion point.

---

## 2. Stale Session ID (P2 — data accuracy)

Tasks are tagged with a stale session ID because hook scripts read `.session_id` from the
per-tool hook payload, which may carry an ID from a prior session.

**Fix:** Write the live session ID to `/tmp/cc-session-current` on `SessionStart`, then have
`pre-tool-agent.ts` and `pre-tool-all.ts` read from that file instead of the payload field.

**Impact:** Session filter in dashboard, task-to-chat attribution, and external sharing all
depend on this being correct.

---

## 3. Parent Tree Verification (P4b — needs live testing)

The `parentId` tree rendering was tested with mock data only.
Never formally exercised with a real orchestrator session dispatching subagents that include
`[parentId:XXX]` tags in their description.

**Next step:** Run a real parallel agent session and verify the tree renders correctly.

---

## 4. Skill Attribution v2 (P4a — feature)

Current v1 captures the `/skill-name` string only.
Planned v2: source classification (`anthropic | vercel | custom | community`), UI filter,
author + experimental flag tracking.
No schema changes required — the `metadata` JSON field on `sessionEventsTable` holds extras.

---

## 5. `post-task.ts` taskId bug (P3 — CLI utility)

`post-task.ts` extracts `taskId` from the raw `ReadableStream` instead of parsing the JSON
body. The CLI tool doesn't return a valid `taskId` via stdout.

**Fix:** `const { id } = await res.json()` instead of reading the stream directly.
