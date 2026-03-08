# Lessons Learned: The Ghost Writer Bug + Pipeline Validation

**Date:** 2026-03-08
**Severity:** High
**Status:** Resolved

---

## Incident Summary

**What happened:** The Claude Agent Dashboard's hook pipeline was completely broken. Hook scripts
were writing task data directly to `db.json` using `jq`, but json-server had already loaded its
own in-memory copy at startup. Every `GET /api/tasks` returned the stale startup state (empty
array). The dashboard polled successfully but showed zero tasks — despite `db.json` having valid
data on disk.

**Impact:** Dashboard appeared to work (no errors, UI loaded, polling active) but silently showed
nothing. Would have been invisible to any new user who didn't know what to look for.

**Resolution:** Rewrote both hook scripts to use `curl` against the json-server REST API. Added
observability via `logs/hooks.log` + `tail -F` in `bun run dev`. Added `Array.isArray` guard in
`useTaskPolling`. Added `bun run smoke` end-to-end verification script.

**Time to resolution:** ~45 minutes from symptom to fix verified.

---

## Timeline

> **Sources:** Pre-fix steps reconstructed from conversation context (hooks.log didn't exist yet).
> Post-fix steps confirmed by `logs/hooks.log` (first entry: `[03:59:01]`).

| Time | Source | Action | Actor | Outcome |
|------|--------|--------|-------|---------|
| Session start | Conversation | User reports: "I'm not seeing the web app update the table with agents" | User | Trigger |
| ~03:45 | Conversation | Checked `lsof` — both json-server (:3001) and Vite (:5173) confirmed running | Claude | Servers up |
| ~03:45 | Conversation | Read `db.json` — 4 tasks present with correct structure | Claude | Data exists on disk |
| ~03:45 | Conversation | Read `post-tool-agent.sh` — uses `jq ... > db.json.tmp && mv` | Claude | File write pattern identified |
| ~03:46 | Conversation | `curl -s http://localhost:3001/tasks` → `[]` | Claude | **Root cause confirmed** |
| ~03:47 | Conversation | Rewrote both hooks to use `curl POST/GET/PUT` | Claude | Fix applied |
| ~03:51 | Conversation | Manual pre/post-hook simulation — task appears as `running` then `completed` | Claude | Fix verified |
| ~03:56 | Conversation | Added `Array.isArray` guard in `useTaskPolling.ts` | Claude | Defensive layer 1 |
| 03:59:01 | hooks.log | First hook log entry: `OK: created task test-log-001` | Claude | **Observability live** |
| ~04:07 | hooks.log | `bun run smoke` — all 8 checks pass (smoke-test entries visible in log) | Claude | Smoke test passes |
| ~04:09 | hooks.log | Background agents: pre/post both fire at `04:09:42` — 0s duration | User/hooks.log | New issue discovered |
| 04:13:40–04:15:13 | hooks.log | Foreground explore agent: 93s elapsed, result in log | Claude | Full lifecycle confirmed |
| 04:15:22–04:16:30 | hooks.log | Foreground code review agent: 68s elapsed, result in log | Claude | Full lifecycle confirmed |

---

## Root Cause Analysis

**Why did the dashboard show no tasks?**
→ Because `GET /api/tasks` returned an empty array.

**Why did the API return empty?**
→ Because json-server's in-memory store had no tasks.

**Why did json-server have no tasks in memory?**
→ Because tasks were written directly to `db.json` on disk, bypassing json-server entirely.

**Why were tasks written directly to disk?**
→ Because the hooks used `jq` file manipulation — a pattern that works for simple file-backed
scripts but is wrong for a server that owns its data layer.

**Why was the wrong pattern used?**
→ Because the mental model was "json-server reads `db.json` like a database reads a file."
In reality, json-server loads once at startup and owns the data in memory after that.

**Root Cause:** Incorrect mental model of json-server's data layer. It behaves more like an
in-process cache with disk persistence than a file-backed server that re-reads on each request.

---

## Contributing Factors

| Category | Factor | Contribution |
|----------|--------|--------------|
| **Technical** | json-server's two-layer architecture is non-obvious | File mutations look identical to API mutations from the outside |
| **Process** | No end-to-end verification step existed | Could deploy hooks that silently don't work |
| **Observability** | Hook scripts had no logging — all output was `/dev/null` | Silent failures looked identical to successes |
| **Testing** | No smoke test to verify full signal chain | Broken state undiscoverable without manual curl inspection |
| **Mental model** | "File = truth" assumption about json-server | Led to direct file writes instead of API calls |

---

## Second Incident: Background Tasks Complete Instantly

**What happened:** Both agents launched with `run_in_background: true` appeared in the dashboard
as `completed` with `0s` duration — before they had actually done any work.

**Root Cause:** Claude Code's PostToolUse hook fires **once**, at the moment a background task
is dispatched — not when the background agent finishes. So `startedAt == completedAt` and the
log says "Background task dispatched" rather than the actual result.

**Key Insight:** Background vs. foreground is a meaningful architectural distinction for the
dashboard, not a performance toggle. Background tasks = dispatch log only. Foreground tasks =
full lifecycle tracking (running → completed, real duration, result in logs).

---

## Fixes Implemented

| Fix | Type | Location | Status |
|-----|------|----------|--------|
| Hook scripts use `curl` REST API instead of `jq` file writes | Rewrite | `scripts/pre-tool-agent.sh`, `scripts/post-tool-agent.sh` | Done |
| `Array.isArray` guard before `buildTree()` | Defensive code | `src/hooks/useTaskPolling.ts:49` | Done |
| `logs/hooks.log` with timestamped OK/ERROR entries | Observability | `scripts/pre-tool-agent.sh`, `scripts/post-tool-agent.sh` | Done |
| `tail -F logs/hooks.log` as 4th `concurrently` process | Observability | `package.json` dev script | Done |
| `bun run smoke` end-to-end verification script | Testing | `scripts/smoke-test.sh` | Done |
| db.json bootstrap retained as pre-flight check | Defensive code | Both hook scripts | Done |
| Foreground vs background agents treated as separate cases | Documentation | `FOR_ETHAN.md`, conversation | Done |

---

## Verification

**Test scenario:** `bun run smoke` while `bun run dev` is active.

**Success criteria:** All 8 checks pass:

1. json-server responds HTTP 200
2. Vite proxy responds HTTP 200
3. Pre-hook creates task as `running`
4. Task has ≥1 log entry
5. Post-hook updates status to `completed`
6. `progressPercentage` = 100
7. Log entry appended (≥2 total)
8. Task visible through Vite proxy

**Confirmed:** 8/8 passing at 04:07. Foreground agent lifecycle confirmed at 04:13–04:16 with
real durations (93s explore, 68s code review).

---

## Lessons

### 1. The two-layer trap: "it's on disk" doesn't mean "the server sees it"

Any server that maintains in-memory state — json-server, Redis, most databases — has a gap
between its memory and the backing store. Writing directly to the backing store bypasses the
memory layer entirely. Always ask: *who owns this data?* If a server owns it, write through
the server, not around it.

**Encoded in:** `FOR_ETHAN.md` Blooper 16 — "The Ghost Writer Bug"

### 2. Silent failures are deferred debugging

`> /dev/null` was the original curl output sink. This made hook failures completely invisible —
indistinguishable from successes. The extra 10 lines to add `log()` + HTTP status capture pays
for itself the first time something goes wrong at 2am.

**Rule:** Every external call (curl, fetch, subprocess) should log its outcome — success and
failure — at the place it's called.

**Encoded in:** `FOR_ETHAN.md` Blooper 17 — "Silent failures are hidden bugs"

### 3. Verify end-to-end before assuming the system works

The hooks, json-server, Vite proxy, and React polling are four separate links. Any one of them
can fail silently. A smoke test that exercises every link in sequence is the minimum viable
verification — and it should be the first thing a new user runs.

**Rule:** Complex pipelines need integration tests, not just unit tests. "It runs without errors"
is not the same as "data flows end-to-end."

**Encoded in:** `scripts/smoke-test.sh`, `bun run smoke`

### 4. Background vs. foreground is an architectural choice, not a performance switch

`run_in_background: true` isn't faster — it just changes who waits. For the dashboard to track
real lifecycle (running → done, elapsed time, result logs), the agent must run in the foreground.
Background tasks are only useful when you want to fire-and-forget without blocking the
conversation thread.

**Rule:** Choose foreground when you want observability. Choose background when you want
non-blocking dispatch and don't need to monitor progress.

**Encoded in:** Agent tool calls going forward, conversation context

### 5. Verify with the lowest-level tool available

The diagnostic that cracked this open was a single curl command:

```bash
curl -s http://localhost:3001/tasks | jq 'length'
# → 0
```

Don't start debugging at the React layer when you can go straight to the API. Always verify
from the source outward, not the UI inward.

**Rule:** Debugging order: data source → API → proxy → client. Not the other way around.
