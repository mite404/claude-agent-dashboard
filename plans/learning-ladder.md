# Learning ladder

Hands-on tasks, easiest first.
Each one is small, has a visible result, and teaches something that transfers.

Tasks 1–3 already have full executor plans in this directory — this file is the
running order and the "why bother", not a duplicate of the steps.

| # | Task | Teaches | Time | Detail in | Status |
|---|------|---------|------|-----------|--------|
| 1 | Fix the dead health check | Silent failure | 5 min | [002](002-fix-posttool-all-health-check.md) | TODO |
| 2 | Guard `JSON.parse` in the hooks | Trust boundaries | 30 min | [003](003-guard-hook-json-parse.md) | TODO |
| 3 | Reject cross-origin `/spawn` | CORS is not security | 45 min | [001](001-harden-reachable-servers.md) | TODO |
| 4 | Signal/noise classifier | Domain judgment as code | 20 min | [trajectory](trajectory.md) step 1 | BLOCKED |
| 5 | Zoom-level collapse | Grouping and derived views | 40 min | [trajectory](trajectory.md) step 3 | BLOCKED |

---

## 1. Fix the dead health check — 5 min

**Do this one first.**
`hook_events` has had **0 rows since the typo was introduced**, so the payoff is measurable
in one command.

Both files check `${API_BASE}/api/tasks`, but the Hono server registers `/tasks`.
The `/api` prefix only exists in Vite's dev proxy, which hooks never go through.
The HEAD request 404s, `r.ok` is false, and the hook exits `0` before doing anything.

1. In `scripts/post-tool-all.ts` line 28, delete `/api` from the fetch URL.
2. Do the same at `scripts/pre-tool-all.ts` line 28.
   Plan 002 only names `post-tool-all.ts`; the same bug is in both.
3. Restart `bun run dev`, then run any tool in a Claude Code session.
4. Check it worked:

```bash
sqlite3 data/dashboard.db "select count(*) from hook_events"
```

Zero becomes non-zero. That is the whole test.

**The lesson:** every hook exits `0` when the health check fails, so Claude Code reports
success and `logs/hooks.log` says `SKIP`.
Nothing anywhere says "this has never worked."
Compare `session_events` at 286 rows — same author, same pattern, one different URL.

## 2. Guard `JSON.parse` in the hooks — 30 min

Follow [plan 003](003-guard-hook-json-parse.md).
Same try/catch in four files, which is the point — repetition builds the reflex.

**The lesson:** stdin is a trust boundary.
Anything crossing into your program from outside gets validated, no exceptions.
A hook that cannot parse its input has nothing useful to do, so it logs and exits `0`
rather than throwing and interrupting the agent.

## 3. Reject cross-origin `/spawn` — 45 min

Follow [plan 001](001-harden-reachable-servers.md), especially Step 2.
This is the one worth doing slowly.

**The lesson:** `Access-Control-Allow-Origin` controls whether a page can *read your
response*.
It does nothing to stop the request from arriving and firing a side effect.
`/spawn` opens a terminal and types `claude`.
Any website you visit while `bun run dev` is running can trigger that today.

That distinction catches experienced developers regularly.
Read plan 001's "Why this matters" section before touching code.

## 4. Signal/noise classifier — BLOCKED

Blocked until `src/lib/parseTranscript.ts` exists ([trajectory plan](trajectory.md) step 1).

You will decide which transcript attachments earn a row in Trajectory and which are hidden.
The proposed line is in [CONTEXT.md](../CONTEXT.md) under **Context Injection**: an
attachment earns a row if it *changed what the agent knew or could do*.

This is yours rather than mine because the line was inferred from a single transcript.
You have watched these sessions; the classification is judgment, not lookup.

## 5. Zoom-level collapse — BLOCKED

Blocked until `TrajectoryView.tsx` exists ([trajectory plan](trajectory.md) step 3).

One function, three densities — Duration shows every row, Turns collapses to Turn
boundaries with roll-up counts, Calls keeps Assistant steps and rolls up Tool Calls.

Closely related to the recursive `sortNodes` pattern already in `TaskTable.tsx`:
one implementation, behaviour varied by argument, rather than three near-identical functions.
