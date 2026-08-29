# Why the Worktree hooks were removed

Date: 2026-08-26

## Symptom

Conductor failed to create workspaces:

    WorktreeCreate hook failed: hook succeeded but returned no worktree path

Nothing in Conductor's docs covers this. The error is Claude Code's, not
Conductor's. Conductor only surfaces it because it launches Claude Code, which
reads `~/.claude/settings.json`.

## Cause

`~/.claude/settings.json` registered this project as the `WorktreeCreate` and
`WorktreeRemove` handler:

    "WorktreeCreate": [{ "hooks": [{ "type": "command",
      "command": ".../scripts/session-event.ts --event-type WorktreeCreate" }]}]

`session-event.ts` is telemetry. It POSTs to `localhost:3001` and writes nothing
to stdout. Reproduced directly:

    $ echo '{"session_id":"t1","branch":"x"}' \
        | ./scripts/session-event.ts --event-type WorktreeCreate
    exit code : 0
    stdout    : 0 bytes

Exit 0 with empty stdout is exactly "hook succeeded but returned no worktree
path".

## The rule this broke

Claude Code hooks fall into two classes.

**Class A, advisory.** Claude Code discards stdout and ignores a nonzero exit.
`Stop`, `SubagentStop`, `Notification`, `PreCompact`, `SessionEnd`,
`SessionStart`*, `PostToolUse`. Safe for telemetry: if the script dies, nothing
downstream changes.

**Class B, consumed.** Claude Code reads the output and acts on it.

| Event                               | What Claude Code takes from it                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `WorktreeCreate` / `WorktreeRemove` | stdout **is** the worktree path (bare path, or `{"worktree_path":..., "cwd":...}`) |
| `UserPromptSubmit`                  | stdout is injected into the model's context                                        |
| `SessionStart`                      | stdout is injected into the model's context                                        |
| `PreToolUse`                        | exit code `2` blocks the tool call                                                 |

Registering a `WorktreeCreate` hook does not mean "notify me when a worktree is
created". It means **"you create it, and tell me where you put it."** Claude
Code stops running `git worktree add` itself the moment the hook exists.

A Class B hook cannot fail gracefully. The failure is not an error, it is
silence being read as data.

> Never register a Class B hook for observation.

\* `SessionStart` is Class A for control flow but Class B for stdout. Keep it
silent.

## Changes applied

1. **`~/.claude/settings.json`** — deleted the `WorktreeCreate` and
   `WorktreeRemove` blocks (was lines 278-297). Claude Code resumes its
   built-in `git worktree add`. Backup: `~/.claude/settings.json.bak-worktreehook`.
   The unrelated top-level `"worktree": { "baseRef": "fresh" }` was left alone.

2. **All 5 hook scripts** — added a deadline to the `isServerUp` probe:

       fetch(`${API_BASE}/tasks`, { method: 'HEAD', signal: AbortSignal.timeout(300) })

   There was no timeout anywhere. A closed port refuses instantly, so this was
   invisible. But if anything ever _binds_ 3001 without answering (a stalled
   `bun dev`, a paused debugger, another project taking the port), every hook in
   every session on this machine hangs until Claude Code's 60s hook timeout.
   Symptom would be "Claude is frozen" in an unrelated repo.

3. **`pre-tool-all.ts`, `post-tool-all.ts`** — server-down path was
   `console.error("[ERROR] Dashboard server unreachable")` + `exit(1)`. Dashboard
   off is the normal state, so that printed on every tool call in every session.
   Now a silent `exit(0)`.

Verified after the change, with the server down:

    session-event.ts     exit=0 stdout=0B stderr=0B
    pre-tool-all.ts      exit=0 stdout=0B stderr=0B
    pre-tool-agent.ts    exit=0 stdout=0B stderr=0B
    post-tool-all.ts     exit=0 stdout=0B stderr=0B
    post-tool-agent.ts   exit=0 stdout=0B stderr=0B

## Getting worktree telemetry back, the Class A way

The dashboard still has the plumbing: `SessionEventType` includes
`'WorktreeCreate' | 'WorktreeRemove'` (`src/types/task.ts:52`), summaries exist
(`src/lib/SessionEventUtils.ts:119`), icons exist (`src/lib/taskConfig.tsx:194`),
tests exist. Note that in 23.6K of `logs/hooks.log` these fired **zero** times,
so nothing was actually lost.

Two ways to repopulate them without touching a Class B event:

**Option 1, derive it at `SessionStart` (Class A).** A session running inside a
worktree can detect that itself. Inside a linked worktree,
`git rev-parse --git-dir` and `--git-common-dir` differ; in the main checkout
they match. So in `session-event.ts`, on `SessionStart`, shell out once and emit
a `WorktreeCreate`-shaped event with the `branch` field the dashboard already
expects. This reports "a session is running in worktree X on branch Y", which is
the signal a dashboard actually wants. There is no removal counterpart;
`SessionEnd` covers the useful half.

Caveat: `SessionStart` stdout is injected into the model's context. Whatever you
shell out to must not leak to stdout, or you are prepending git output to every
session's prompt. Redirect to stderr or `/dev/null`.

**Option 2, poll from the server.** Have the dashboard backend run
`git worktree list --porcelain` against tracked repos on an interval and diff.
Zero hooks, so zero blast radius on other sessions, and it sees worktrees created
by hand or by Conductor, not just ones Claude Code made.

### Which one

Option 2. These are not equivalent, and the difference is the whole lesson.

Option 1 still puts code in **every session's startup path**. Smaller blast
radius than a Class B hook, but not zero: it is still this project's code running
inside unrelated sessions, and it is still a file you edit while those sessions
are live.

Option 2 has no hook at all, so there is no mechanism by which this project can
break another Claude Code session, ever. It also sees worktrees created by hand
or by Conductor, not just ones Claude Code made. Larger picture from less
coupling.

The general shape, worth keeping past this bug: a hook is a **synchronous
dependency you inject into someone else's control flow**. Polling is an
**observer that owns its own failure**. When the consumer is "every session on
this machine" and the producer is a side project under active edit, the observer
wins on both correctness and blast radius.

## Still open

Global settings point at this **live working tree**. A half-saved edit to
`session-event.ts` is a syntax error in every running Claude Code session
immediately. Decoupling would mean pointing `~/.claude/settings.json` at a
stable installed copy and developing against a second port. Not done.
