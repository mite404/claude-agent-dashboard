#!/usr/bin/env bun
/**
 * PR Watcher — polls a GitHub PR for new commits, spawns a Claude Code review
 * agent when one is detected. Zero AI cost between checks.
 *
 * Usage:
 *   bun scripts/pr-watcher.ts --pr <num> [--skill <name>] [--interval <secs>] [--repo <owner/repo>]
 *
 * --skill is optional. Default skills always run (architecture + testing).
 * Pass --skill to add a domain-specific reviewer for a particular PR.
 *
 * Examples:
 *   bun scripts/pr-watcher.ts --pr 42
 *   bun scripts/pr-watcher.ts --pr 42 --skill compound-engineering:ce-security-reviewer
 *   bun scripts/pr-watcher.ts --pr 42 --skill pr-review-toolkit:code-reviewer --interval 120
 */

// ── Data ──────────────────────────────────────────────────────────────────────

const API = 'http://localhost:3001'; // Hono server — no /api prefix for direct calls
const CLAUDE = '/Users/ea/.local/bin/claude';

// These run on every PR review. Pass --skill to add a domain-specific one on top.
const DEFAULT_SKILLS = [
  'compound-engineering:ce-architecture-strategist',
  'compound-engineering:ce-testing-reviewer',
];

function parseArgs() {
  const args = Bun.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? (args[i + 1] ?? null) : null; };
  // getAll collects every value for a repeatable flag, e.g. --context a --context b → ['a', 'b']
  const getAll = (flag: string) => args.flatMap((a, i) => a === flag && args[i + 1] ? [args[i + 1]] : []);
  const pr = get('--pr');
  if (!pr) {
    console.error(
      'Usage: bun scripts/pr-watcher.ts --pr <num> [--skill <name>] [--context <file>] [--self-correct] [--interval <secs>] [--repo <owner/repo>]',
    );
    process.exit(1);
  }
  const extra = get('--skill');
  return {
    pr: Number(pr),
    skills: extra ? [...DEFAULT_SKILLS, extra] : DEFAULT_SKILLS,
    contextFiles: getAll('--context'),
    selfCorrect: args.includes('--self-correct'),
    interval: Number(get('--interval') ?? 300),
    repo: get('--repo') ?? undefined,
  };
}

// ── Calculations ──────────────────────────────────────────────────────────────

// State file lives next to the script so it's consistent regardless of cwd
const stateFile = (pr: number) => new URL(`.pr-watcher-${pr}.json`, import.meta.url).pathname;

function reviewPrompt(
  taskId: string,
  pr: number,
  sha: string,
  skills: string[],
  contextFiles: string[],
  selfCorrect: boolean,
): string {
  const skillLines = skills.map((s) => `   - Use the Skill tool with name "${s}"`).join('\n');
  const contextSection = contextFiles.length
    ? `Before reviewing, read these project context files using the Read tool:
${contextFiles.map((f) => `   - ${f}`).join('\n')}
   Use them to understand the intended architecture and flag deviations.\n\n`
    : '';
  const selfCorrectStep = selfCorrect
    ? `
5. Invoke the Ponytail skill before touching any files:
   Use the Skill tool with name "ponytail"
   This enforces minimal changes — no new abstractions, shortest diff wins.
6. Apply the proposed fixes to the local files using the Edit tool.
   Match exactly what you described in the comment — nothing more.
   Then commit and push to the PR branch:
   git add -A && git commit -m "auto-fix: <brief summary of what changed>"
   git push
   (The comment already records your reasoning — this commit is the applied fix.)

7. Mark task done:   curl -sX PATCH ${API}/tasks/${taskId} \\
                       -H 'Content-Type: application/json' \\
                       -d '{"status":"completed","progressPercentage":100}'`
    : `
5. Mark task done:   curl -sX PATCH ${API}/tasks/${taskId} \\
                       -H 'Content-Type: application/json' \\
                       -d '{"status":"completed","progressPercentage":100}'`;

  return `You are an automated code reviewer. Use Bash for shell commands, Read/Edit for files.

PR #${pr} · Commit ${sha.slice(0, 7)} · Dashboard task ID: ${taskId}

${contextSection}Complete all steps in order:
1. Fetch the diff:   gh pr diff ${pr}
2. Review the diff by invoking each skill below using the Skill tool, then synthesize findings:
${skillLines}
3. Format your findings as a Markdown comment. For each issue use this structure:

   ---
   🔴 **Critical** | \`path/to/file.ts\` line N   ← correctness bug, data loss, security
   🟠 **Major**    | \`path/to/file.ts\` line N   ← wrong behavior, broken feature
   🟡 **Minor**    | \`path/to/file.ts\` line N   ← style, naming, minor inefficiency

   [1-2 sentence description of the problem]

   **Proposed fix:**
   \`\`\`diff
   - old line
   + new line
   \`\`\`
   ---

   If no issues found, write a single ✅ **No issues** line instead.

4. Post the review:  gh pr review ${pr} --comment --body "<your formatted review>"
${selfCorrectStep}`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadState(pr: number): Promise<string | null> {
  try {
    return (JSON.parse(await Bun.file(stateFile(pr)).text()) as { sha: string }).sha;
  } catch {
    return null;
  }
}

async function saveState(pr: number, sha: string): Promise<void> {
  await Bun.write(stateFile(pr), JSON.stringify({ sha }));
}

async function getHeadSha(pr: number, repo?: string): Promise<string | null> {
  const proc = Bun.spawn(
    ['gh', 'pr', 'view', String(pr), '--json', 'headRefOid', ...(repo ? ['--repo', repo] : [])],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  // Read stdout and wait for exit concurrently — avoids deadlock if output fills the pipe buffer
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) return null;
  return (JSON.parse(text) as { headRefOid: string }).headRefOid ?? null;
}

async function createDashboardTask(pr: number, sha: string, skills: string[]): Promise<string> {
  const res = await fetch(`${API}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Review PR #${pr} @ ${sha.slice(0, 7)}`,
      sessionId: 'pr-watcher',
      agentType: skills.join(', '),
      priority: 'normal',
      status: 'unassigned',
      description: `Auto-review commit ${sha} — skills: ${skills.join(', ')}`,
    }),
  });
  if (!res.ok) throw new Error(`POST /tasks failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

async function claimDashboardTask(id: string): Promise<void> {
  const res = await fetch(`${API}/tasks/${id}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimedBy: 'pr-watcher' }),
  });
  // 409 = already claimed (shouldn't happen, but not fatal)
  if (!res.ok && res.status !== 409) throw new Error(`claim failed: ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { pr, skills, contextFiles, selfCorrect, interval, repo } = parseArgs();
const dim = '\x1b[2m', rst = '\x1b[0m', green = '\x1b[32m', yellow = '\x1b[33m';

console.log(`\nPR Watcher  #${pr}  every ${interval}s${repo ? `  [${repo}]` : ''}`);
console.log(`Skills:  ${skills.map((s) => `/${s}`).join(', ')}`);
if (selfCorrect) console.log(`Mode:    self-correct (will apply fixes and push)`);
console.log('────────────────────────────────────────');
if (contextFiles.length) {
  contextFiles.forEach((f) => console.log(`context added: ${f.split('/').pop() ?? f}`));
  console.log('────────────────────────────────────────');
}

let lastSha = await loadState(pr);

if (!lastSha) {
  // First run: record HEAD as baseline without reviewing it.
  // Only commits that arrive after this point will trigger a review.
  const sha = await getHeadSha(pr, repo);
  if (!sha) {
    console.error('Cannot reach GitHub — is `gh` authenticated?');
    process.exit(1);
  }
  lastSha = sha;
  await saveState(pr, sha);
  console.log(`${yellow}baseline${rst}  ${sha.slice(0, 7)} — watching for new commits`);
} else {
  console.log(`${dim}resuming from ${lastSha.slice(0, 7)}${rst}`);
}

// ponytail: while(true) — exits only on Ctrl-C or an unhandled throw
while (true) {
  await Bun.sleep(interval * 1000);

  const sha = await getHeadSha(pr, repo).catch(() => null);
  if (!sha) { console.log(`${dim}GitHub unreachable — retrying in ${interval}s${rst}`); continue; }
  if (sha === lastSha) { console.log(`${dim}no change (${sha.slice(0, 7)})${rst}`); continue; }

  console.log(`${green}↑ new commit${rst}  ${sha.slice(0, 7)}`);

  const taskId = await createDashboardTask(pr, sha, skills);
  await claimDashboardTask(taskId);
  console.log(`  task ${dim}${taskId}${rst} → spawning review agent`);

  const proc = Bun.spawn([CLAUDE, '--max-turns', '30', '-p', reviewPrompt(taskId, pr, sha, skills, contextFiles, selfCorrect)], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;

  lastSha = sha;
  await saveState(pr, sha);
  console.log(`  ${green}✓${rst} review complete — next check in ${interval}s`);
}
