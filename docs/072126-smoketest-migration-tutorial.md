# Tutorial: Migrating smoke-test.sh → smoke-test.ts

**Goal:** Rewrite `scripts/smoke-test.sh` in TypeScript so you can read, edit, and own it.
Estimated time: under an hour.

**What you'll practice:**

- Leaf-to-tree file organization: imports → data → calculations → actions → main
- The Calculations / Data / Actions model from functional programming
- `async/await` and `fetch()` — the modern way to make HTTP calls
- Optional chaining (`?.`) and nullish coalescing (`??`) — safe property access
- `JSON.stringify()` — the TypeScript replacement for `jq`
- `Bun.spawn()` — running a subprocess from TypeScript

---

## Part 1 — The Three Layers: Data, Calculations, Actions

Before writing a line, understand the model that shapes how this file is organized.
Every piece of code in a program falls into exactly one of three categories.

### Data

Plain values.
No logic, no behavior — just shape.
A string is data.
An object is data.
The result of `JSON.stringify()` is data.

```typescript
const TEST_ID = `smoke-test-${Date.now()}`; // data

const payload = {
  // data
  tool_use_id: testId,
  session_id: 'smoke-test',
};
```

### Calculations

Pure functions.
Same input → same output, every time.
No network calls, no filesystem writes, no random numbers, no `Date.now()` inside.
A calculation is safe to call zero times, once, or a thousand times — the world stays the same.

```typescript
function buildPrePayload(testId: string): string {  // calculation
  return JSON.stringify({ tool_use_id: testId, ... });
}
```

You can test a calculation by just calling it with known inputs and checking the output.
No mocking required.

### Actions

Functions that touch the world.
`fetch()` is an action.
`Bun.spawn()` is an action.
`console.log()` is an action (it writes to stdout).
An action depends on *when* and *how many times* you call it.

```typescript
async function checkEndpoint(url: string): Promise<boolean> {
  // action
  const res = await fetch(url); // ← network call = action
  return res.ok;
}
```

### The leaf-to-tree rule

Write your **leaves** (calculations, pure data) at the top of the file.
Write your **trunk** (main, which calls everything) at the bottom.

Leaves have no dependencies on other custom code — they're self-contained.
The trunk depends on leaves, so it must come after them.
This isn't style preference; it's because JavaScript/TypeScript reads files top to bottom.
A function must exist before you can call it.

```
FILE LAYOUT
─────────────────────────────
imports            ← third-party tools
constants / DATA   ← plain values
pure helpers       ← CALCULATIONS (no side effects)
side-effect fns    ← ACTIONS (network, process, filesystem)
main()             ← the trunk — orchestrates everything
```

This matches `smoke-test.sh` exactly — the bash script also declares variables at the top,
defines helper functions in the middle, and runs the steps at the bottom.

---

## Part 2 — Bash → TypeScript cheat sheet

| Bash                                         | TypeScript equivalent                      | What it does                     |
| -------------------------------------------- | ------------------------------------------ | -------------------------------- |
| `curl -s -o /dev/null -w "%{http_code}" URL` | `(await fetch(url)).status`                | HTTP status code                 |
| `curl -s URL`                                | `await (await fetch(url)).json()`          | Fetch + parse JSON body          |
| `jq -n '{key: "val"}'`                       | `{ key: "val" }`                           | Build a JSON object              |
| `JSON.stringify(obj)`                        | `JSON.stringify(obj)`                      | Serialize to a JSON string       |
| `echo "$JSON" \| bash "$SCRIPT"`             | `Bun.spawn([...], { stdin })`              | Run a script with piped input    |
| `echo "$X" \| jq -r '.status // "missing"'`  | `data?.[field] ?? "missing"`               | Safe property read with fallback |
| `trap cleanup EXIT`                          | `process.on("exit", cleanup)`              | Run cleanup when process exits   |
| `PASS=$((PASS + 1))`                         | `pass++`                                   | Increment a counter              |
| `echo -e "\033[0;32m✓\033[0m $msg"`          | ``console.log(`\x1b[32m✓\x1b[0m ${msg}`)`` | Colored terminal output          |

---

## Part 3 — Create the file and copy the scaffold

Create `scripts/smoke-test.ts` and paste this in. **Do not edit it yet — read each section.**

```typescript
#!/opt/homebrew/bin/bun
/**
 * Smoke test for the Claude Agent Dashboard signal chain.
 * Mirrors smoke-test.sh — now in TypeScript so you can actually read it.
 *
 * FILE LAYOUT (leaf-to-tree):
 *   1. imports
 *   2. DATA        — plain values, no logic
 *   3. CALCULATIONS — pure functions, no side effects
 *   4. ACTIONS     — functions that touch the network or filesystem
 *   5. main()      — the trunk, calls everything above
 *
 * Usage: bun scripts/smoke-test.ts
 * (Run while `bun run dev` is active in another terminal)
 */

// ── 1. IMPORTS ────────────────────────────────────────────────────────────────
// (none needed — fetch and Bun are global in the Bun runtime)

// ── 2. DATA ───────────────────────────────────────────────────────────────────
// Plain values. No logic. Safe to read anywhere in the file.

const DASHBOARD_DIR = new URL('..', import.meta.url).pathname;
const PRE_HOOK = `${DASHBOARD_DIR}scripts/pre-tool-agent.ts`;
const POST_HOOK = `${DASHBOARD_DIR}scripts/post-tool-agent.ts`;
const API = 'http://localhost:3001';
const PROXY = 'http://localhost:5173';
const TEST_ID = `smoke-test-${Date.now()}`;

let passed = 0;
let failed = 0;

// ANSI escape codes for terminal color (data, not logic)
const G = '\x1b[32m',
  R = '\x1b[31m',
  Y = '\x1b[33m',
  B = '\x1b[1m',
  X = '\x1b[0m';

// ── 3. CALCULATIONS ───────────────────────────────────────────────────────────
// Pure functions. Same input → same output. No network, no filesystem.
// These are LEAVES — they depend on nothing custom above them.

// Coloured output formatters — pure string transformations (provided)
const fmtOk = (msg: string) => `  ${G}✓${X} ${msg}`;
const fmtFail = (msg: string) => `  ${R}✗${X} ${msg}`;
const fmtInfo = (msg: string) => `  ${Y}→${X} ${msg}`;
const fmtHead = (msg: string) => `\n${B}${msg}${X}`;

// ── Stub A: buildPrePayload ────────────────────────────────────────────────────
// CATEGORY: Calculation — takes a string, returns a string. No side effects.
// In bash: jq -n --arg id "$TEST_ID" '{ tool_use_id: $id, tool_input: {...} }'
function buildPrePayload(testId: string): string {
  const payload = {
    tool_use_id: testId,
    session_id: 'smoke-test',
    tool_input: {
      description: 'Smoke test agent',
      subagent_type: 'general-purpose',
      run_in_background: false,
    },
  };
  return JSON.stringify(payload);
}

// ── Stub B: buildPostPayload ───────────────────────────────────────────────────
// CATEGORY: Calculation — same idea, but adds a tool_response field.
// In bash: jq -n --arg id "$TEST_ID" '{ tool_use_id: $id, ..., tool_response: {...} }'
function buildPostPayload(testId: string): string {
  const payload = {
    tool_use_id: testId,
    tool_input: {
      description: 'Smoke test agent',
      subagent_type: 'general-purpose',
      run_in_background: false,
    },
    tool_response: {
      content: [{ type: 'text', text: 'Smoke test completed successfully.' }],
      is_error: false,
    },
  };
  return JSON.stringify(payload);
}

// ── 4. ACTIONS ────────────────────────────────────────────────────────────────
// Functions with side effects. These touch the world: network, process, stdout.
// They may call CALCULATIONS above, but add an effect on top.

// Output helpers — actions because they write to stdout (provided)
const ok = (msg: string) => {
  console.log(fmtOk(msg));
  passed++;
};
const fail = (msg: string) => {
  console.log(fmtFail(msg));
  failed++;
};
const info = (msg: string) => console.log(fmtInfo(msg));
const head = (msg: string) => console.log(fmtHead(msg));

// Cleanup: delete the test task on exit (provided — action: network + process)
process.on('exit', async () => {
  await fetch(`${API}/tasks/${TEST_ID}`, { method: 'DELETE' }).catch(() => {});
});

// ── Stub C: checkEndpoint ─────────────────────────────────────────────────────
// CATEGORY: Action — makes a network call (fetch), writes to stdout (ok/fail).
// In bash: curl -s -o /dev/null -w "%{http_code}" URL + if/else
async function checkEndpoint(label: string, url: string, expected = 200): Promise<boolean> {
  // TODO(you): implement this function.
  //
  // 1. Call fetch(url) with await. Store the result in a variable called `res`.
  // 2. If res.status equals `expected`, call ok(label) and return true.
  // 3. Otherwise, call fail(`${label} — got HTTP ${res.status}`) and return false.
  //
  // Hint: fetch() is async — you need `await` before it.
  // Hint: res.status is a number (e.g. 200, 404, 500).
  // This is an ACTION because fetch() is a side effect (it hits the network).
  return false; // remove this when you implement it
}

// ── Stub D: verifyTask ────────────────────────────────────────────────────────
// CATEGORY: Action — fetches from network, reads a field, writes to stdout.
// In bash:
//   TASK=$(curl -s "http://localhost:3001/tasks/$TEST_ID")
//   TASK_STATUS=$(echo "$TASK" | jq -r '.status // "missing"')
//   if [ "$TASK_STATUS" = "running" ]; then pass ...; else fail ...; fi
async function verifyTask(
  field: 'status' | 'progressPercentage',
  expected: string | number,
  label: string,
): Promise<void> {
  // TODO(you): implement this function.
  //
  // Each step produces a value the next step needs — work through them in order.
  //
  // 1. You have: API and TEST_ID. Derive: a Response from the network.
  // 2. You have: the Response. Derive: the full task record as a JS object.
  // 3. You have: the task record and `field`. Derive: `actual` — the current value of that field.
  //    The field might be absent — fall back to "missing" if so.
  //    (See the cheat sheet: the jq -r '.status // "missing"' row.)
  // 4. You have: `actual` and `expected`. Derive: a `detail` string for the failure message.
  //    It should read like: ` — expected "running", got "missing"`.
  // 5. You have: `actual`, `expected`, `label`, `detail`. Compare and call ok() or fail().
  //
  // This is an ACTION because it calls fetch() and ok()/fail() (side effects).
}

// runHook: spawn a hook script with JSON piped to its stdin (provided — action)
// In bash: echo "$JSON" | bash "$SCRIPT"
// Bun.spawn() creates a child process; we write the payload to its stdin pipe.
async function runHook(scriptPath: string, payload: string): Promise<void> {
  const proc = Bun.spawn(['/opt/homebrew/bin/bun', scriptPath], {
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: DASHBOARD_DIR,
  });
  proc.stdin.write(payload);
  proc.stdin.end();
  await proc.exited;
}

// ── 5. MAIN ───────────────────────────────────────────────────────────────────
// The trunk. Calls everything above. No pure logic lives here — only sequencing.

console.log(`\n${B}Claude Agent Dashboard — Smoke Test${X}`);
console.log('────────────────────────────────────');
info(`Test task ID: ${TEST_ID}`);

async function main() {
  // Step 1: Hono server
  head('Step 1: Hono server (:3001)');
  const honoUp = await checkEndpoint('GET /tasks → HTTP 200', `${API}/tasks`);
  if (!honoUp) {
    fail('Hono server is not running. Start it with: bun run dev');
    process.exit(1);
  }

  // Step 2: Vite proxy
  head('Step 2: Vite proxy (:5173)');
  await checkEndpoint('GET /api/tasks via Vite proxy → HTTP 200', `${PROXY}/api/tasks`);

  // Step 3: pre-hook
  head("Step 3: Pre-hook (task created as 'running')");
  await runHook(PRE_HOOK, buildPrePayload(TEST_ID));
  await verifyTask('status', 'running', "Task created with status 'running'");

  // Step 4: post-hook
  head("Step 4: Post-hook (task updated to 'completed')");
  await runHook(POST_HOOK, buildPostPayload(TEST_ID));
  await verifyTask('status', 'completed', "Task updated to status 'completed'");
  await verifyTask('progressPercentage', 100, 'progressPercentage = 100');

  // Step 5: Vite proxy end-to-end
  head('Step 5: Task visible through Vite proxy');
  const proxyRes = await fetch(`${PROXY}/api/tasks/${TEST_ID}`);
  const proxyData = (await proxyRes.json()) as Record<string, unknown>;
  const proxyStatus = proxyData?.status ?? 'missing';
  if (proxyStatus === 'completed') {
    ok('Task visible via Vite proxy with correct status');
  } else {
    fail(`Proxy returned unexpected status: '${proxyStatus}'`);
  }

  // Summary
  const total = passed + failed;
  console.log('\n────────────────────────────────────');
  if (failed === 0) {
    console.log(`${G}${B}All ${total} checks passed.${X} The signal chain is healthy.`);
    console.log("\n  If real agent tasks still aren't appearing in the dashboard, check:");
    console.log('  1. ~/.claude/settings.json has PreToolUse + PostToolUse hooks wired');
    console.log("  2. The hook paths in settings.json point to this project's scripts/");
    console.log('  3. Claude Code is the active session (hooks only fire during tool use)');
    process.exit(0);
  } else {
    console.log(`${R}${B}${failed} of ${total} checks failed.${X} Fix the issues above.`);
    process.exit(1);
  }
}

main();
```

---

## Part 4 — Make it executable

```bash
chmod +x scripts/smoke-test.ts
```

---

## Part 5 — Implement the stubs

Read **A and B** — they are provided so you can see the Calculation pattern without the busywork.
Implement **C and D** — these are the real exercises.
After each implementation, run the script to verify that piece works before moving on.

```bash
bun run dev                    # terminal 1 — keep running
bun scripts/smoke-test.ts      # terminal 2 — run after each stub
```

### Stub A — `buildPrePayload` (Calculation)

**Provided in the scaffold — read, don't implement.**

This function is already written for you.
Your task is to read it and understand *why* it is a pure Calculation.

**The bash equivalent:**

```bash
PRE_INPUT=$(jq -n --arg id "$TEST_ID" '{
  tool_use_id: $id,
  tool_input: {
    description: "Smoke test agent",
    subagent_type: "general-purpose",
    run_in_background: false
  }
}')
```

`jq -n` builds a JSON object from nothing (`-n`), substituting `$id` where needed.
The output is a plain JSON string.
In TypeScript: build a JS object literal, then call `JSON.stringify()` on it.
Same idea — data in, serialized string out.

No `fetch()`. No `console.log()`. No `Date.now()` inside.
Same input → same output, always.
That is all a Calculation ever is.

---

### Stub B — `buildPostPayload` (Calculation)

**Provided in the scaffold — read, don't implement.**

Same pattern as Stub A, plus a `tool_response` field.
Read the implementation in the scaffold and trace the parallel to Stub A.
Check `smoke-test.sh` lines 106–119 for the bash equivalent if you want to see the source.

---

### Stub C — `checkEndpoint` (Action)

**The bash version:**

```bash
TASKS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/tasks)
if [ "$TASKS_RESPONSE" = "200" ]; then
  pass "GET /tasks → HTTP 200"
else
  fail "GET /tasks → HTTP $TASKS_RESPONSE"
fi
```

`curl -o /dev/null` discards the body; `-w "%{http_code}"` prints only the status code.

**Your TypeScript version:**

```typescript
async function checkEndpoint(label: string, url: string, expected = 200): Promise<boolean> {
  const res = await fetch(url);
  // ... your if/else here
}
```

This is an **action** — `fetch()` is a side effect.
It can't be called twice and produce the same result (the server state may change).

---

### Stub D — `verifyTask` (Action)

**The bash version:**

```bash
TASK=$(curl -s "http://localhost:3001/tasks/$TEST_ID")
TASK_STATUS=$(echo "$TASK" | jq -r '.status // "missing"')
if [ "$TASK_STATUS" = "running" ]; then
  pass "Task created with status 'running'"
else
  fail "Expected 'running', got '$TASK_STATUS'"
fi
```

`jq -r '.status // "missing"'` reads the `status` field; if absent, returns `"missing"`.

**The TypeScript translation of `jq -r '.status // "missing"'`:**

```typescript
const data = (await res.json()) as Record<string, unknown>;
const actual = data?.[field] ?? 'missing';
```

- `as Record<string, unknown>` — tells TypeScript "trust me, this is an object with string keys"
- `data?.[field]` — reads `data["status"]` safely; if `data` is `null`, returns `undefined`
  instead of throwing a TypeError
- `?? "missing"` — if the left side is `null` or `undefined`, fall back to `"missing"`

**About the `detail` string (step 4 in the stub comment):**

`detail` is not a built-in — it is a variable you need to define.
The stub comment uses it as a name for "the diagnostic part of the failure message."
Build it from `actual` and `expected` before your `if` block:

```typescript
const detail = ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
```

Then in the `else` branch: `fail(label + detail)`.
The full output for a failing check becomes something like:

```
✗ Task created with status 'running' — expected "running", got "missing"
```

`label` is the test name. `detail` is the reason it failed. Concatenating them gives you a
failure message that tells you both *what* broke and *why*.

---

## Part 6 — Run the full thing

```bash
bun scripts/smoke-test.ts
```

All five steps should show green checkmarks.
If a step fails, the error message tells you the HTTP status you got vs. what was expected.

---

## Quizzes

Answer from memory. Answers are revealed at the bottom.

**Q1.** `buildPrePayload` and `buildPostPayload` are Calculations.
`checkEndpoint` and `verifyTask` are Actions.
What is the test-writability difference between them?
Why can you test a Calculation without starting the server?

**Q2.** What does `await` do to `fetch(url)`?
What would happen if you wrote `const res = fetch(url)` without `await`,
then checked `res.status`?

**Q3.** The bash script uses `curl -s -o /dev/null -w "%{http_code}"`.
What does `-o /dev/null` do, and why doesn't the TypeScript version need an equivalent?

**Q4.** What does `data?.[field] ?? "missing"` return if `data` is `null`?
What does it return if `data` is `{ status: "running" }` and `field` is `"status"`?

**Q5.** The file puts Calculations above Actions, and Actions above `main()`.
Besides style, what technical reason enforces this ordering in JavaScript/TypeScript?

**Q6 (bonus).** `fmtOk` is a Calculation. `ok` is an Action.
They're almost identical code.
What is the single thing that makes `ok` an Action and `fmtOk` a Calculation?

---

## Answers

---

**A1.** A Calculation only takes inputs and returns outputs.
You can call `buildPrePayload("abc")` and inspect the returned string in a test — no network
required, no server required, no timing involved.
An Action touches the world.
To test `checkEndpoint`, you'd need the Hono server running and a real network connection.
Keeping calculations separate from actions means you can test pure logic independently —
and trust it works before the world even enters the picture.

---

**A2.** `fetch(url)` starts the network request and immediately returns a `Promise<Response>` —
a placeholder for a value that doesn't exist yet.
`await fetch(url)` pauses execution until the network responds, then gives you the actual
`Response` object.
Without `await`, `res` is a Promise, not a Response.
`res.status` on a Promise is `undefined` — there is no `.status` property on a pending future.
You'd silently get `undefined === 200` → `false`, with no error to explain why.

---

**A3.** `-o /dev/null` discards the response body.
In bash, `curl` always downloads the full body — you have to explicitly throw it away if you
only want the status code.
In TypeScript, `fetch()` gives you a `Response` object with `.status` as an immediately
available property.
The body is separate and only parsed when you call `.json()` or `.text()`.
If you don't need the body, you simply never call those methods — nothing to discard.

---

**A4.** If `data` is `null`:

- `data?.[field]` short-circuits at `?.` → returns `undefined` (skips reading `field`
  off `null`, which would throw `TypeError: Cannot read properties of null`)
- `undefined ?? "missing"` → left side is `undefined`, so result is `"missing"`

If `data` is `{ status: "running" }` and `field` is `"status"`:

- `data?.[field]` → `data["status"]` → `"running"`
- `"running" ?? "missing"` → left side is a real string (not null/undefined), result is `"running"`

The `?.` protects against crashes. The `??` provides a fallback. They work as a pair.

---

**A5.** JavaScript/TypeScript is executed top to bottom.
`function foo()` declarations are hoisted (available anywhere in the file), but `const foo = () =>
...` is not — it must appear before any call site.
More importantly, the pattern itself matters: if `main()` is at the top and calls
`buildPrePayload`, you have to scroll down to understand what `buildPrePayload` does before
you can understand `main`.
Leaf-to-tree means every function you encounter only calls things already defined *above it* —
you can read the file straight through without jumping around.

---

**A6.** `fmtOk` takes a string and returns a new formatted string.
No change to the world.
`ok` calls `fmtOk` and then calls `console.log()` — which writes to stdout.
Writing to stdout is a side effect (it changes what appears on the screen, which is external
to the program).
The single call to `console.log()` is enough to classify the entire function as an Action.
Even one side effect inside a function makes it an Action.
This is why `fmtOk` (Calculation) lives in section 3 and `ok` (Action) lives in section 4 —
same idea, different category.
