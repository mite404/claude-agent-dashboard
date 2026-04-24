# `post-tool-agent.ts` Migration Plan (2026-04-23)

The post-hook is the **closing slate** — it fires when an Agent tool call ends and writes the
final status back to the database. The bash script is ~168 lines but the logic is a single
decision tree: did the agent succeed? Was it a background task? Does the task row exist yet?

The interesting translation challenge is the completion summary extractor (Milestone 4) — a
dense `jq` expression that normalises two different payload shapes from different Claude Code
versions. That's your job. Everything else is pattern-matching on what you already built in
`pre-tool-agent.ts`.

---

## Milestone 1 — Scaffold

Create `scripts/post-tool-agent.ts`:

```ts
#!/opt/homebrew/bin/bun
import type { Task } from '../src/types/task';
```

Constants at the top — same pattern as pre-hook:

```ts
const DASHBOARD_DIR = process.cwd();
const LOG_FILE = `${DASHBOARD_DIR}/logs/hooks.log`;
const API_BASE = 'http://localhost:3001';
```

Define the stdin payload shape. Two fields vary by Claude Code version — `tool_response` and
`tool_result` are the same data, just named differently across releases. Model both as optional
so TypeScript doesn't complain when only one is present:

```ts
interface ToolResult {
  is_error?: boolean;
  last_assistant_message?: string;
  content?: string | Array<{ text?: string }>;
}

interface PostToolPayload {
  session_id: string;
  tool_use_id: string;
  tool_input: {
    description?: string;
    subagent_type?: string;
    run_in_background?: boolean;
  };
  tool_response?: ToolResult;
  tool_result?: ToolResult;
}
```

---

## Milestone 2 — stdin parsing

Same pattern as `pre-tool-agent.ts` — pipe stdin through Bun, JSON.parse, destructure with
snake_case → camelCase aliases and defaults:

```ts
const raw = await Bun.stdin.text();
const payload: PostToolPayload = JSON.parse(raw);

const {
  session_id: sessionId = '',
  tool_use_id: taskId = 'unknown',
  tool_input: {
    description: taskName = 'Unnamed task',
    subagent_type: subagentType = 'general-purpose',
    run_in_background: isBg = false,
  } = {},
} = payload;

// Normalise the two possible result field names into one variable
const result = payload.tool_response ?? payload.tool_result ?? {};
const isError = result.is_error ?? false;
const lastMsg = result.last_assistant_message ?? '';
const now = new Date().toISOString();
```

---

## Milestone 3 — Status determination + early exit

Two decisions, both simple:

```ts
// Background tasks: the Agent tool returns immediately but the agent is still running.
// The SubagentStop event (session-event.sh) will mark it complete when it actually finishes.
if (isBg) {
  await log(`INFO: background task ${taskId} — skipping status update (agent still running)`);
  process.exit(0);
}

const status = isError ? 'failed' : 'completed';
const progress = isError ? 0 : 100;
```

`★ Insight ─────────────────────────────────────`
Background tasks are a two-hook story: pre-hook creates the task as `running`, post-hook
normally flips it to `completed` — but for background tasks, that flip must be skipped here
and delegated to `SubagentStop` in `session-event.sh`. The early `process.exit(0)` is
intentional: it keeps the hook fast and leaves status management to the event that actually
knows when the agent is done.
`─────────────────────────────────────────────────`

---

## Milestone 4 — Build the completion log entry (YOUR TASK)

This is the piece worth doing yourself. The bash version (lines 60–94 of the `.sh` file) uses
a complex nested `jq` expression to extract a human-readable summary from `result.content`.

The problem: `content` is not a consistent type. Claude Code has shipped it as:

- A plain string
- An array of content blocks: `[{ text: "..." }, ...]`
- Absent entirely (null/undefined)

**Your task:** In `post-tool-agent.ts`, implement `extractSummary(result: ToolResult): string`.

Hints:

- Check `typeof result.content` to branch on string vs array vs absent
- For array content, take `.[0].text` (the first block's text value)
- Truncate the final string to 300 characters to keep log lines readable
- The full message should be prefixed: `"Task completed: ..."` or `"Task failed: ..."`
  depending on `isError` — that part can live outside this function

The function signature and a stub are in place so the rest of the milestones compile:

```ts
// TODO(human): implement extractSummary — see Milestone 4 in migration plan
function extractSummary(result: ToolResult): string {
  // your implementation here
  return '';
}
```

Use it like:

```ts
const summary = extractSummary(result);
const logMessage = isError ? `Task failed${summary}` : `Task completed${summary}`;

const newLog = {
  timestamp: now,
  level: isError ? 'error' : 'info',
  message: logMessage,
};
```

---

## Milestone 5 — `log()` function

You already wrote this in `pre-tool-agent.ts`. Paste it in, change the prefix from
`[pre-hook]` to `[post-hook]`, done.

```ts
async function log(msg: string) {
  const timeStr = new Date().toISOString().slice(0, 19) + 'Z';
  const line = `[${timeStr}] [post-hook] ${msg}\n`;
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}
```

Note: `log()` is called before it's defined in Milestones 3 and 4. Move the function
definition to the top of the file (or use `async function` hoisting — both work in Bun).

---

## Milestone 6 — Fetch the existing task

The post-hook needs to check whether the pre-hook already created the task row. If it did,
we PATCH. If not (e.g., hook was just installed mid-session), we POST a fallback. Fetch first:

```ts
const existingRes = await fetch(`${API_BASE}/tasks/${taskId}`);
const existing = existingRes.ok ? (await existingRes.json() as Task) : null;
```

`existingRes.ok` is `true` for any 2xx status. A 404 (task not found) gives `ok = false`,
so `existing` becomes `null` — that's your branch condition in Milestone 7.

---

## Milestone 7 — Two-path dispatch: PATCH existing or POST fallback

**Path A — task exists:** PATCH with the updated fields. The server merges this with the
existing row via Drizzle's `.update()`:

```ts
if (existing) {
  const patch = {
    status,
    completedAt: now,
    progressPercentage: progress,
    ...(sessionId && { sessionId }),
    ...(lastMsg && { lastAssistantMessage: lastMsg }),
    logs: [newLog],
  };

  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  res.ok
    ? await log(`OK: updated task ${taskId} → ${status}`)
    : await log(`ERROR: PATCH /tasks/${taskId} failed (HTTP ${res.status})`);
```

**Path B — task missing:** The pre-hook raced or was not yet installed. Create a minimal
fallback record. Model it after the `newTask` object in `pre-tool-agent.ts`, but set
`status` and `completedAt` to the values you already computed above. Include `newLog` in the
`logs` array. POST to `/tasks`. Log `WARN:` on success (this path should be rare).

The fallback POST is yours to wire up — you have all the pieces. The only non-obvious field:
set `startedAt` and `createdAt` both to `now` (we don't know when it actually started).

---

## Milestone 8 — Remove dead code

Two things to delete that are json-server leftovers:

- Lines 15–16: `DB_FILE` constant (never used in Hono world)
- Lines 22–26: the `if [ ! -f "$DB_FILE" ]` bootstrap block

These were no-ops since the SQLite migration. Don't port them.

---

## Milestone 9 — Make executable and wire up

```bash
chmod +x scripts/post-tool-agent.ts
```

Update `~/.claude/settings.json` — find the `PostToolUse` hook entry and change the command
path from `scripts/post-tool-agent.sh` to `scripts/post-tool-agent.ts`.

Confirm the old `.sh` is not also listed. Two hooks firing = every task gets double-patched,
which is harmless but noisy and signals a wiring mistake.

---

## Milestone 10 — Live test

- `bun run dev`
- Trigger an agent session
- In `logs/hooks.log` confirm:
  - `[post-hook] OK: updated task <id> → completed` (or `failed`)
  - No `ERROR:` lines for normal runs
- In the dashboard: task status flips from `running` → `completed` on the next poll
- Trigger a background task: confirm the status stays `running` after post-hook fires
- Pull the task out of the DB directly and verify `completedAt` and `progressPercentage`
  are set: `curl http://localhost:3001/tasks/<id>`
