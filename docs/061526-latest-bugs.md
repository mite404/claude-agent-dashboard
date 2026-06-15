# 🎯 What's Actually Left To Do

## 1. Stale Session ID (P2) — Real bug, real impact

Tasks are tagged with stale session IDs because `pre-tool-agent.ts` reads the session ID from the
hook payload instead of a live state file. The `session-event.ts` handler receives the real
`.session_id` on `SessionStart` but orchestrator agents need to write it somewhere the task hooks
can read.

> If you care about session filtering or task-to-chat attribution working correctly, this is the
> thing to fix.

### 2. Skill Attribution v2 (P4a)

Current v1 captures `/skill-name` string. v2 upgrades:

- Source classification (`anthropic | vercel | custom | community`)
- Skill source UI filter (checkbox popover, same pattern as Status/Agent filters)
- Author + experimental flag tracking

### 3. Parent Tree Verification (P4b)

The `parentId` tree rendering was tested with mock data. IMPLEMENTATION.md notes it was **never
formally exercised with live hook data** (i.e., a real parallel agent session dispatching sub-agents
with `[parentId:XXX]` tags). If you run orchestrator agents, this is worth verifying actually works
end-to-end.

### 4. Postman Collections

You have 4 modified Postman collection files sitting uncommitted. These were probably updated to
match the new kanban endpoints (`GET /tasks/pool`, `POST /tasks/:id/claim`) but never committed.

---

## 🧭 My Recommendation

**If you want a "warm up" task** to get back into the codebase: commit those 4 Postman files
(they're docs, low risk) and verify `bun run dev` still boots cleanly after 6 weeks.

**If you want to tackle a real bug:** Fix the stale session ID (P2). It has a clear problem
statement, a proposed solution in IMPLEMENTATION.md (write `/tmp/cc-session-current` on
`SessionStart`, read it in `pre-tool-agent.ts`), and it affects data accuracy for everything
downstream.

**If you want a feature:** Skill attribution v2 (P4a) is well-scoped — add fields to types, extend
the UI filter, no schema changes needed.
