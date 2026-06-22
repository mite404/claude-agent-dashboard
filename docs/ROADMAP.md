# Dashboard Roadmap

Captures the feature plan discussed in the June 2026 session.
Near-term items are bugs or small improvements ready to pick up now.
Long-term items are architectural expansions that need design time first.

---

## ✅ Built this session (2026-06-22)

### pr-watcher v1

A long-lived polling daemon that watches a GitHub PR and spawns a code review agent on
each new commit.

| Feature | Detail |
| ------- | ------ |
| Polling + SHA detection | `gh pr view --json headRefOid` every N seconds |
| Dashboard card lifecycle | `unassigned → claimed → completed` with outcome summary |
| CodeRabbit-style review | Structured findings with severity icons + language-fenced fixes |
| Compound-engineering skills | correctness · api-contract · reliability (always on) |
| `--repo` flag | Watch PRs in any GitHub repo, not just the current one |
| `--context` flag | Inject SPEC.md / IMPLEMENTATION.md into review prompt |
| `--self-correct` flag | Agent applies fixes locally, commits (no push — user controls that) |
| `--skill` flag | Add a domain-specific skill on top of the defaults |
| Cross-repo CWD usage | Run from target repo's directory; state files namespaced by repo slug |
| Model pinned | `claude-sonnet-4-6` — no accidental Opus burn |
| Prompt injection defense | Fetched diff treated as data, not instructions |
| Exit code gate | `lastSha` only advances on clean exit — failed reviews retry |
| Claim guard | 409 on claim skips spawning; prevents duplicate agents |
| CLI validation | `--pr` and `--interval` validated as positive numbers |
| Flag value guard | `isValue()` type predicate prevents flags capturing adjacent flags |

---

## Near-term — Bugs & small fixes

These are tracked in `docs/061526-latest-bugs.md` with root causes and fix locations.

### P1 — EventTrailRow always empty

`GET /tasks` doesn't JOIN `hook_events` into the response, so `task.events` is always
`undefined` in the frontend.

**Where:** `src/server.ts` — `GET /tasks` handler has a `TODO(human)` placeholder.

**Fix:** `inArray(hookEventsTable.taskId, rows.map(r => r.id))` → group by taskId →
attach as `events[]` on each row.

---

### P2 — Stale session ID on tasks

Hook scripts read `.session_id` from the per-tool payload, which can carry an ID from a
prior session. Session filter and task-to-chat attribution are broken when this happens.

**Where:** `scripts/pre-tool-agent.ts`, `scripts/pre-tool-all.ts`

**Fix:** Write live session ID to `/tmp/cc-session-current` on `SessionStart` in
`session-event.ts`. Hook scripts read from that file instead of the payload field.

---

### P3 — `post-task.ts` taskId bug

`post-task.ts` reads `taskId` from a raw `ReadableStream` instead of parsing the JSON body.
The CLI utility doesn't return a valid `taskId` via stdout.

**Where:** `scripts/post-task.ts`

**Fix:** `const { id } = await res.json()`.

---

## Long-term — Architectural expansions

### pr-watcher v2

| Feature | Why |
| ------- | --- |
| **Webhook trigger** | Replace polling with a GitHub webhook so reviews fire instantly. Polling wastes a full interval window after each push. |
| **`--workdir` flag** | Explicit local path for self-correct mode. Currently CWD must match the target repo, which is error-prone when running from another directory. |
| **Skill selection per-review** | A dashboard UI or extended CLI flag to switch reviewer profile (security, performance, accessibility) without restarting the watcher. |
| **Multi-PR watching** | Run multiple watcher instances sharing a single dashboard backend. State files are already namespaced; the gap is a launcher / process manager. |
| **Review diffing across commits** | Compare findings between consecutive commits to show regressions vs. resolved issues over time. |

---

### Dashboard coordination layer

The dashboard is already usable as an active agent coordination layer (agents claim tasks
from the pool). These features would make that workflow more ergonomic.

| Feature | Why |
| ------- | --- |
| **Skill attribution v2** | Source classification (anthropic / vercel / custom / community), UI filter by skill source, author + experimental flag tracking. No schema change — `metadata` JSON field already exists. |
| **Parent tree live verification** | The `parentId` tree UI was tested with mock data only. Needs a real orchestrator session dispatching subagents with `[parentId:XXX]` tags to verify end-to-end. |
| **Task templates** | Pre-fill "New Task" form from a library of common task types (code-review, security-audit, refactor). Dashboard-only change. |
| **Bulk pre-population from YAML** | Accept a YAML/JSON file of tasks to seed the board in one command, for planned sprints or assessment setup. `post-task.ts` is the natural extension point once its bug is fixed. |

---

## Priority order (suggested)

1. **EventTrailRow fix (P1)** — `TODO(human)` placeholder ready, clear spec, high visibility
2. **Stale session ID (P2)** — low-touch fix, high accuracy impact
3. **`post-task.ts` bug (P3)** — one-liner, unblocks bulk pre-population
4. **Webhook trigger** — most impactful pr-watcher upgrade; eliminates poll latency
5. **Skill attribution v2** — well-scoped, no schema change
6. **Parent tree verification** — needs a live agent session, not a code change
