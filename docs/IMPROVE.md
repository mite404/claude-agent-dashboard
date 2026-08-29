# Codebase Audit — Prioritized Findings

> Audited at commit `4f0beea` (2026-07-08), standard depth.
> Method: recon + three parallel audit passes (correctness/security,
> performance/architecture, tests/deps/DX/docs), every finding re-verified
> against the cited source before inclusion.
> Baseline: `bunx vitest run` 133/133 pass (7 files), `bunx tsc --noEmit` clean,
> `oxlint` 7 warnings, **no CI** enforces any of it.
> Not audited: `docs/` prose depth, `src/components/ui/*` (shadcn primitives),
> `scripts/shell-scripts-backup/*.bak`, dependency CVE scan.

## How to read this

Leverage-ordered (impact ÷ effort, weighted by confidence).
This is a local dev tool with no auth by design — so severity is judged against
"what can a malicious webpage or a malformed payload do to the developer's
machine," not against a public-internet threat model.
P0 = reachable code execution or silent data-pipeline breakage.
P1 = cheap, high-value. P2 = structural. P3 = hygiene.
Effort: S (< half day), M (1–2 days), L (multi-day).

---

## P0 — Reachable harm

### 1. `POST /spawn` runs a terminal for any webpage that asks (SEC-02)

- **Evidence**: `scripts/spawn-terminal.ts:46-53` runs
  `Bun.spawn(['osascript','-e',script])` — which opens a terminal and types
  `claude` — for any POST to `/spawn`. The `Access-Control-Allow-Origin`
  header (line 3) only gates _reading the response_; the side effect fires
  before CORS is consulted, and the real caller
  (`TaskTable.tsx:1206`) sends a header-less "simple request" with no preflight.
- **Impact**: any website the developer visits can `fetch('http://localhost:3002/spawn', {method:'POST'})`
  and spawn a local terminal running `claude`. This is the one endpoint where a
  request reaches a shell — the highest-value target in the repo.
- **Fix**: verify `Origin` and `Host` server-side (reject anything but
  `localhost:5173` / loopback), or require a per-session token. Pair with #2.
- Effort: S · Risk: low · Confidence: high.

### 2. Both dev servers bind to all interfaces, not loopback (SEC-01)

- **Evidence**: `scripts/spawn-terminal.ts:43` and `src/server.ts:490-495` call
  `Bun.serve` / export `{ fetch, port }` with no `hostname`; Bun defaults to
  `0.0.0.0`.
- **Impact**: the task API (:3001) and the spawn server (:3002) are reachable
  from any host on the LAN with no auth — anyone on the network can read/mutate
  the task DB or (with #1) trigger the terminal spawn. This is _why_ the
  "no auth is fine, it's localhost" assumption doesn't hold: the socket isn't
  loopback-only.
- **Fix**: pass `hostname: '127.0.0.1'` to both.
- Effort: S · Risk: low · Confidence: medium (Bun's documented default; not runtime-verified here).

### 3. `post-tool-all.ts` health-checks a route that doesn't exist — the hook never runs (BUG-01)

- **Evidence**: `scripts/post-tool-all.ts:28` fetches `${API_BASE}/api/tasks`
  (HEAD). The server registers `/tasks`, not `/api/tasks` — the `/api` prefix
  exists only in Vite's dev proxy, which hooks don't traverse.
  The sibling `scripts/session-event.ts:45` correctly uses `/tasks`.
  So `r.ok` is always false and line 32 `process.exit(0)` fires every time.
- **Impact**: the "mark non-Agent tool events completed/failed" hook is dead in
  practice — per-tool event status on the main session is never updated.
  Latent second bug: if it ever proceeded, `existing.events.map` (line 99) would
  throw because GET /tasks returns no `events` (the tracked P1 join gap).
- **Fix**: change the health check to `/tasks`; guard `events` with `?? []`.
- Effort: S · Risk: low · Confidence: high.

### 4. Every hook crashes on malformed stdin (BUG-02)

- **Evidence**: unguarded `JSON.parse(raw)` in `scripts/pre-tool-agent.ts:29`,
  `post-tool-agent.ts:42`, `post-tool-all.ts:38`, `session-event.ts:31`; then
  `session-event.ts:32` calls `payload.session_id.replace(...)` with no null
  check.
- **Impact**: empty or malformed stdin (or a payload missing `session_id`)
  throws before any logging, so the hook exits non-zero and the failure is
  opaque — exactly the class of hook crash that interrupts the agent flow.
- **Fix**: wrap parse in try/catch that logs and `process.exit(0)`; default
  `session_id` to `''` before `.replace`.
- Effort: S · Risk: low · Confidence: high.

---

## P1 — Cheap, high leverage

### 5. No CI gate (DX-01) + no typecheck in `build` (DX-02)

- **Evidence**: no `.github/` directory; `package.json:8` `build` is just
  `vite build`, yet `AGENTS.md:27` claims build does a "TypeScript check". Nothing
  runs `tsc`, `oxlint`, or `vitest` on push. `vite build` transpiles without
  type-checking, so type-broken code can ship.
- **Fix**: change `build` to `tsc --noEmit && vite build`; add one CI workflow
  running `bun install`, `tsc --noEmit`, `oxlint`, `vitest run`, and the css/md
  linters. The whole toolchain is already clean — CI just enforces it.
- Effort: S–M · Risk: low · Confidence: high.

### 6. Log writer re-reads and rewrites the whole file per line (BUG-03)

- **Evidence**: every `log()` — `pre-tool-agent.ts:108`, `post-tool-agent.ts:105`,
  `post-tool-all.ts:52`, `session-event.ts:35`, `post-task.ts:52` — does
  `existing = await file.text()` then `Bun.write(file, existing + line)`.
- **Impact**: hooks fire concurrently across sessions/subagents; two overlapping
  `log()` calls read the same `existing` and the second write clobbers the
  first's line (silent log loss). Cost also grows O(n²) as the log grows.
- **Fix**: append instead (`appendFileSync(LOG_FILE, line, ...)` / a `{flag:'a'}` writer).
- Effort: S · Risk: low · Confidence: high.

### 7. Server API has zero tests (TEST-01)

- **Evidence**: `src/server.ts` (495 lines) — every route the hooks POST to and
  the dashboard reads — has no test file; the 133 tests cover only `lib/`,
  `useTaskPolling`, `GlobalEventStrip`, `TaskTree`.
- **Fix**: characterization tests via Hono's `app.request()` against a temp
  SQLite; assert status + persisted row. This is the prerequisite for safely
  touching the server (needed before #12).
- Effort: M · Risk: low · Confidence: high.

### 8. Poll rebuilds everything and re-renders the whole table every 2.5s (PERF-01)

- **Evidence**: `useTaskPolling.ts:71-77` — each tick maps fresh task objects and
  calls `setTree(buildTree(data))`, allocating a new `TaskNode` per task, so
  `tree` is a new reference every poll even when nothing changed.
  `TaskTable.tsx:763-818` — four `useMemo([...,tree])` recompute every tick;
  `:737-760` two `useEffect([tree])` run every tick; no `React.memo` anywhere,
  so every `TaskRow` re-renders.
- **Impact**: continuous O(N log N) sort + N row re-renders on an idle dashboard;
  visible jank and wasted battery on busy sessions.
- **Fix**: compare fetched JSON (or a hash) to the previous poll and skip all
  `setState` when identical; drop `setLastUpdated(new Date())` on unchanged data;
  memoize `TaskRow`.
- Effort: M · Risk: medium (equality too coarse can mask real updates; watch the
  in-place `computeBlockedState` mutation) · Confidence: high.

### 9. Poll fetches have no abort / in-flight guard (PERF-02)

- **Evidence**: `useTaskPolling.ts:63-98` — `setInterval` fires `fetch_()` with no
  `AbortController` and no "already in flight" check; `Dashboard.tsx:32-38`
  schedules an extra `refresh()` 300 ms after each status change, stacking on the
  interval.
- **Impact**: responses slower than 2.5s pile up and can apply out of order
  (flicker/stale renders); a late response can `setState` after unmount.
- **Fix**: one `AbortController` per fetch, abort the previous; skip a tick if one
  is in flight; abort on cleanup.
- Effort: S · Risk: low · Confidence: high.

### 10. Mass assignment on the POST handlers (SEC-03)

- **Evidence**: `src/server.ts:203-217` (`POST /tasks`) strips only
  `logs/events/dependencies` then spreads `...safeFields`, so any real column
  (`claimedBy`, `agentId`, timestamps…) is settable by the body;
  `:440-447` (`POST /sessionEvents`) spreads `...body` with no whitelist at all —
  while `handleTaskUpdate:263-282` deliberately whitelists via `validCols`.
- **Impact**: a caller can pre-claim a task, backdate timestamps, or inject
  session-event columns. Low severity at localhost posture, but it's the exact
  inconsistency where the write path skips the guard the update path enforces.
- **Fix**: apply the `validCols` whitelist to both POST handlers.
- Effort: S · Risk: low · Confidence: high.

---

## P2 — Structural

### 11. TaskTable.tsx is a 1442-line god-file (ARCH-01)

One file defines `FilterPopover`, four detail-row components, `TaskRow`,
`SortHeader`, and a `TaskTable` owning ~14 `useState` plus sort/filter/selection/
column/bulk-action/create-form logic (51 KB — an order of magnitude above the
component median).
Extract the detail rows, toolbar, and create-form into their own files; consider
a `useTaskTableState` hook. Landing #8's memoization is easier afterward.
Effort: L · Risk: medium · Confidence: high.

### 12. Two divergent sources of truth for task status (ARCH-04)

`src/server.ts:16-25` `VALID_STATUSES` has 8 values (no `pending`);
`src/lib/taskConfig.tsx:41-64` `ALL_STATUSES` has 9 (includes `pending`, verified).
The client can filter a `pending` status the server rejects as an invalid
`?status`. Extract the status list to a plain `.ts` module both import (server
can't import the `.tsx` config). Do after #7.
Effort: S · Risk: low · Confidence: high.

### 13. Dead component cluster (ARCH-02)

`TaskTree → TaskCard → LogViewer / ControlButtons` is unreachable: `main.tsx`
renders only `Dashboard`, which imports only `TaskTable` and `KanbanBoard`.
`TaskTree` has no importers (the `TaskCard` grep hits are KanbanBoard's separate
`NewTaskCard`). Delete the four components + `TaskTree.test.tsx`, or record them
as intended future work in `ROADMAP.md`.
Effort: S · Risk: low · Confidence: high.

### 14. Status→color/label config duplicated and already drifted (ARCH-03)

`taskConfig.tsx:66-154` centralizes status config, but `TaskCard.tsx:29-39`
re-implements it as inline `rgb(...)` (green/blue/yellow) and `KanbanBoard.tsx:87-92`
keeps its own `PRIORITY_COLOR`. Since TaskCard is dead (#13), most of the drift is
invisible. Delete the dead copy; move still-needed maps into `taskConfig`.
Effort: S · Risk: low · Confidence: high.

### 15. Unbounded `GET /sessionEvents` re-fetched every poll (PERF-03)

`src/server.ts:382-403` returns the entire table (no LIMIT/ORDER BY); the table
only grows (insert-only + manual "Clear all"), and the client re-fetches it every
2.5s. Add `ORDER BY timestamp DESC LIMIT n` + an optional `since` cursor; consider
retention.
Effort: M · Risk: low · Confidence: high.

---

## P3 — Hygiene

| #   | Finding                                                                                       | Evidence                                       | Fix                                                           |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| 16  | AGENTS.md issue tracker points at `mite404/a24-puzzle` (wrong repo) + phantom `docs/agents/*` | `AGENTS.md` issue-tracker section              | fix slug to `claude-agent-dashboard`; create or drop the refs |
| 17  | AGENTS.md Key Files references `.sh` hooks migrated to `.ts`                                  | `AGENTS.md` Key Files table                    | update `.sh` → `.ts`                                          |
| 18  | AGENTS.md says `lint # ESLint`; it's oxlint                                                   | `AGENTS.md:30`                                 | correct to oxlint                                             |
| 19  | Stale `eslint.config.js` + `.prettierrc.json` tracked after OXC migration (deps absent)       | both files tracked                             | delete both                                                   |
| 20  | Test libs in `dependencies` not `devDependencies`                                             | `package.json` (`@testing-library/*`, `jsdom`) | move to devDeps                                               |
| 21  | `vite-tsconfig-paths` unneeded (Vite 8 native); prints deprecation                            | `vite.config.ts`, `package.json`               | native `resolve.tsconfigPaths`, drop dep                      |
| 22  | `SessionEventUtils.ts` PascalCase among camelCase siblings — CI/Linux footgun                 | `src/lib/`                                     | `git mv` to `sessionEventUtils.ts`, update 2 imports          |
| 23  | `docs/` has no index; dated files + `zOLD/`/`zExamples/` mixed with canonical                 | `docs/`                                        | add `docs/README.md` marking canonical vs archived            |

## Lower-priority / watch items

- **Per-request `console.log` on hot poll endpoints** (`src/server.ts`, many
  lines): synchronous stdout on every `GET /tasks`/`GET /sessionEvents` buries
  real errors. Gate behind a debug flag. Folds naturally into #15.
- **No server-side change detection** (PERF-04): ETag / `updatedAt` cursor would
  let polls return `304` on no change. Worthwhile only once table sizes justify
  it; magnitude unmeasured here.
- **PATCH `validCols` hand-mirrors the schema** (ARCH-05): derive from Drizzle's
  `getTableColumns` so adding a column doesn't silently drop in PATCH. Latent.
- **pr-watcher state files loose in `scripts/`** (ARCH-07): correctly gitignored,
  but mixing runtime data with source; move to a dedicated ignored dir and wrap
  the `while(true)` loop in try/catch with backoff.
- **`getHeadSha` baseline parse unguarded** (BUG-04): `pr-watcher.ts:184` — an
  odd `gh` stdout with exit 0 crashes the daemon at startup (the loop caller
  already guards). Wrap in try/catch returning null.
- **pr-watcher spawns a review agent with `Bash,Read,Edit` on untrusted diffs**:
  the injection defense (prompt labels tool output as data) holds and is
  documented, but the only barrier between a malicious diff and local Bash is
  that one instruction. Acceptable for a self-run tool; worth knowing before
  pointing it at untrusted PRs.

## Considered and rejected

- pr-watcher command injection — none: `gh` calls use array-form `Bun.spawn`
  (no shell), and only the validated `sha` from GitHub reaches the prompt.
  Model pinning, exit-code gate, and the atomic 409 claim guard all hold as
  documented.
- `spawn-terminal.ts` `osascript` injection — none: `buildScript` interpolates
  only a fixed terminal enum + hardcoded `"claude"`; no request data reaches it.
  The real risk is reachability (#1/#2).
- `.DS_Store`, `.pr-watcher-*.json` committed — false; all correctly gitignored
  and untracked.
- PATCH `validCols` as SQL-injection risk — false; Drizzle parameterizes and keys
  are filtered against a static list.
- `GET /tasks` missing hook_events JOIN, stale session ID, parent-tree
  verification — tracked already in `docs/061526-latest-bugs.md`; not re-filed.
- `FOR_ETHAN.md` size — by-design per AGENTS.md.

---

## Direction (product options, not ranked against the bugs)

1. **Close the P1 event-trail bug the roadmap already specs** — `GET /tasks`
   isn't joining `hook_events`, so the event trail row is always empty and
   `computeBlockedState` has nothing to work with. The fix is scoped in
   `docs/061526-latest-bugs.md` with a `TODO(human)` marker in `src/server.ts:62`.
   Highest user-visible payoff; do it right after the server gets tests (#7).
2. **Skill attribution v2** — roadmap item; v1 captures the `/skill-name` string,
   v2 adds source classification + UI filter with no schema change (the
   `metadata` JSON field already holds extras). A self-contained feature once the
   dashboard's render performance (#8) is under control.
3. **pr-watcher robustness pass** — it's the most novel piece here and clearly
   headed for unattended use. Before that, it wants the loop-crash guards
   (BUG-04, ARCH-07) and a restart/backoff story. Small, and it protects the
   feature you're most likely to lean on.

## Suggested execution order

1 → 2 (lock down reachable execution, ship together) → 3 → 4 → 6 (dead/ crashing
hooks + log races — the ingestion pipeline) → 5 (CI so nothing regresses) →
7 (server tests) → 8, 9, 10 → then P2, where #7's tests must land before #12,
and #13 (delete dead code) should precede #14 (dedup config).
