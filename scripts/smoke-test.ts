#!/opt/homebrew/bin/bun
/**
 * Smoke test for the Claude Agent Dashboard signal chain.
 * Mirrors smoke-test.sh — now in TypeScript so you can actually read it.
 *
 * Tests every link between Claude Code hooks and the dashboard UI:
 *   1. Hono REST API is up on :3001
 *   2. Vite dev server proxy is up on :5173
 *   3. pre-hook creates a task as "running"
 *   4. post-hook updates it to "completed" and appends a log entry
 *   5. Task is visible through the Vite proxy (/api/tasks)
 *   6. Cleanup (deletes the test task)
 *
 * If all steps pass: the app is healthy. Agent tasks will appear in the dashboard.
 * If steps 1-5 pass but you still don't see real agents: check your LLM provider
 * or confirm ~/.claude/settings.json has the hooks wired.
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

// ANSI escape codes for terminal color
const G = '\x1b[32m',
  R = '\x1b[31m',
  Y = '\x1b[33m',
  B = '\x1b[1m',
  X = '\x1b[0m';

// ── 3. CALCULATIONS ───────────────────────────────────────────────────────────
// Pure functions. These are LEAVES — they depend on nothing custom above them.

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
process.on('ext', () => {
  void fetch(`${API}/tasks/${TEST_ID}`, { method: 'DELETE' }).catch(() => {});
});

// ── Stub C: checkEndpoint ─────────────────────────────────────────────────────
// CATEGORY: Action — makes a network call (fetch), writes to stdout (ok/fail).
// In bash: curl -s -o /dev/null -w "%{http_code}" URL + if/else
async function checkEndpoint(label: string, url: string, expected = 200): Promise<boolean> {
  const res = await fetch(url);
  if (res.status === expected) {
    ok(label);
    return true;
  } else {
    fail(`${label} — got HTTP ${res.status}`);
    return false;
  }
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
  const res = await fetch(`${API}/tasks/${TEST_ID}`);
  const data = await res.json();
  const actual = data?.[field] ?? 'missing';
  const detail = ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;

  if (actual === expected) {
    ok(label);
  } else {
    fail(label + detail);
  }
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
  void proc.stdin.write(payload);
  void proc.stdin.end();
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
  const honoUp = await checkEndpoint('GET /tasks -> HTTP 200', `${API}/tasks`);
  if (!honoUp) {
    fail('Hono server is not running. Start it with: bun rund dev');
    process.exit(1);
  }

  // Step 2: Vite proxy
  head('Step 2: Vite proxy (:5173)');
  await checkEndpoint('GET /api/tasks via Vite proxy -> HTTP 200', `${PROXY}/api/tasks`);

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

void main();
