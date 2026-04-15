Milestone 1 — Create the file scaffold

- Create `scripts/pre-tool-agent.ts`
- Add shebang as **line 1**: `#!/opt/homebrew/bin/bun`
- Add imports: `import type { Task, TaskKind } from '../src/types/task'`
- Define a local interface for the Claude Code hook payload (stdin shape) — this isn't in
  `task.ts` yet because it's hook-specific:
  ```ts
  interface PreToolPayload {
    session_id: string;
    tool_use_id: string;
    tool_name: string;
    tool_input: {
      description?: string;
      subagent_type?: string;
      run_in_background?: boolean;
    };
  }
  ```
- Define constants for `LOG_FILE` and `API_BASE` (`http://localhost:3001`)

---

## Milestone 2 — Replace stdin parsing

- Replace `INPUT=$(cat)` + four `jq -r` calls with:
  ```ts
  const raw = await Bun.stdin.text();
  const payload: PreToolPayload = JSON.parse(raw);
  ```
- Destructure with aliases to convert snake_case → camelCase:
  ```ts
  const { 
    session_id: sessionId = '',
    tool_use_id: taskId = '',
    tool_name: rawName = 'Unnamed task',
    tool_input: { subagent_type: subagentType = 'general-purpose' } = {}
  } = payload;
  ```

---

## Milestone 3 — Replace the three tag parsers (parentId, dependsOn, kind)

This is the densest bash in the file — three separate `grep -oE` + `sed` chains. Each becomes
one regex match:

```ts
const parentId = rawName.match(/\[parentId:([^\]]+)\]/)?.[1] ?? null;
const dependsOnRaw = rawName.match(/\[dependsOn:([^\]]+)\]/)?.[1] ?? '';
const dependsOn = dependsOnRaw ? dependsOnRaw.split(',').map((id) => id.trim()) : [];
const kind = rawName.match(/\[kind:([^\]]+)\]/)?.[1] ?? null;

// Strip all three tags from the display name
const displayName = rawName.replace(/\s*\[(?:parentId|dependsOn|kind):[^\]]*\]/g, '').trim();
```

The regex `/\s*\[(?:parentId|dependsOn|kind):[^\]]*\]/g` handles leading/trailing/inline cases
in one pass (bash does three separate `sed` calls).

`★ Insight ─────────────────────────────────────`
Bash runs three separate `sed` passes on `TASK_NAME` for each tag to handle different positions.
TypeScript's regex with the global flag (`g`) and optional leading whitespace (`\s*`) collapses
all three cases into one efficient `.replace()` call. The `?` operator on `.match()` safely returns
`undefined` if no match, so chaining with `??` provides clean fallbacks.
`─────────────────────────────────────────────────`

---

## Milestone 4 — Replace the `kind` inference fallback

The bash `case "$SUBAGENT_TYPE"` block (lines 73–80) maps agent type strings to task kinds.
Replace with TypeScript conditionals:

```ts
function inferKind(agentType: string): string {
  const lower = agentType.toLowerCase();
  if (lower.includes('code-reviewer') || lower.includes('reviewer')) {
    return 'evaluation';
  }
  if (lower.includes('architect') || lower.includes('planner') || lower.includes('plan')) {
    return 'planning';
  }
  return 'work';
}

// Only infer if no [kind:...] tag was found
const finalKind = kind ?? inferKind(subagentType);
```

Match the bash patterns: `*code-reviewer*`, `*reviewer*`, `*architect*`, `*planner*`, `*Plan*`.

---

## Milestone 5 — Replace temp file operations

First, sanitize the session ID (remove special chars) to create a safe filename:
```ts
const safeSid = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
```

Two temp files are written:

- `/tmp/cc-agent-task-${safeSid}` — stores `taskId` for the SubagentStart hook to read
- `/tmp/cc-skill-${safeSid}` — read to get the originating skill (written by session-event.sh)

Write the task ID:
```ts
await Bun.write(`/tmp/cc-agent-task-${safeSid}`, taskId);
```

Read the skill file:
```ts
const skillFile = Bun.file(`/tmp/cc-skill-${safeSid}`);
const originatingSkill = (await skillFile.exists()) ? (await skillFile.text()).trim() : null;
```

---

## Milestone 6 — Build the typed task object

Build a plain TypeScript object with these fields:
```ts
const newTask = {
  id: taskId,
  name: displayName,
  status: 'running',
  agentType: subagentType,
  parentId: parentId || null,
  sessionId,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  kind,
  originatingSkill,
  // Optional: include logs for the server to record the startup event
  logs: [{
    timestamp: new Date().toISOString(),
    level: 'info',
    message: `Task started: ${displayName}`
  }]
};
```

**Note:** The server's POST handler (line 181 in `src/server.ts`) filters out `logs`, `events`,
and `dependencies` before inserting into the tasksTable — these are passed through but stored
separately (logs in logsTable). Don't expect them to come back in the response.

---

## Milestone 7 — Replace `curl` with `fetch`

- Replace the `curl -s -w "\n%{http_code}"` call with:
  ```ts
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newTask),
  });
  ```
- Replace the bash HTTP code extraction (`tail -n1`) with `res.status`
- Log success/failure the same way as the bash version

---

## Milestone 8 — Replace the `log()` function

The bash version appends to a file with `echo "..." >> $LOG_FILE`. In Bun, use:

```ts
async function log(msg: string) {
  const timeStr = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const line = `[${timeStr}] [pre-hook] ${msg}\n`;
  
  // Append to log file (creates if missing)
  const file = Bun.file(LOG_FILE);
  const existing = (await file.exists()) ? await file.text() : '';
  await Bun.write(file, existing + line);
}
```

Keep the same `OK:` / `ERROR:` / `WARN:` prefix conventions — the `concurrently` terminal
display depends on the format for visual parsing.

---

## Milestone 9 — Remove dead code

- Delete the entire `db.json` bootstrap block (lines 19–23 of the bash file) — `DB_FILE` is
  never used in the Hono/SQLite world and this check has been a no-op since PR #26

---

## Milestone 10 — Make executable and wire up

Make the file executable with the Bun shebang:
```bash
chmod +x scripts/pre-tool-agent.ts
```

Update `~/.claude/settings.json`:
- Find the existing `PreToolUse` hook command
- Change the path from `scripts/pre-tool-agent.sh` to `scripts/pre-tool-agent.ts` (same directory, `.ts` extension)
- The shebang (`#!/opt/homebrew/bin/bun` at line 1) tells the OS to run it with Bun

**Critical:** Confirm the old `.sh` file is **not** also wired in settings.json — both firing
would create duplicate tasks. If found, remove or comment out the old hook entry.

---

## Milestone 11 — Live test

- Start `bun run dev`
- Fire a real Claude Code agent session
- Confirm in `logs/hooks.log` the `[pre-hook] OK: created task ...` line appears
- Confirm the task appears in the dashboard with correct name, agentType, parentId, and kind
- Confirm no task is created twice (i.e., the `.sh` file is fully decommissioned)
