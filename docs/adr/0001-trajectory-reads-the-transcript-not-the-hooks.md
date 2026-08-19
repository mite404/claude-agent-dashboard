# Trajectory reads the transcript, not the hooks

Status: accepted

Trajectory must show every decision and action in a Conversation Thread — including the
agent's reasoning between tool calls.
Claude Code's hooks fire only around tools, so assistant reasoning, injected context, and
the system prompt never pass through them; hooks can supply roughly 40% of what Trajectory
needs and no amount of schema work changes that.
The session transcript at `~/.claude/projects/<project-slug>/<session-id>.jsonl` contains
all of it, already structured.

So: **Trajectory reads the transcript. The hooks keep feeding the simple view.**
Responsibilities split by view, and neither pipeline is asked to do the other's job.

## Considered options

- **Hooks only** — rejected on evidence, not preference. The reasoning text never reaches a
  hook, so the feature as specified cannot be built this way.
- **Both, merged into one table** — rejected. Two writers into one table buys a live push
  path we don't need (the transcript is written incrementally and can be tailed) in
  exchange for permanent dedup and ordering logic.

## Consequences

The transcript format is internal to Claude Code and carries no stability guarantee.
A future release could rename `promptId` or `toolUseResult` and break Trajectory with no
compile-time warning.
We accept that risk because the alternative is not building the feature.

To contain it, **exactly one module parses the raw JSONL** and maps it to our own types.
Nothing downstream touches Claude Code's field names.
When the format shifts, one file changes.

The transcript also gives us fields we would otherwise have had to derive badly:
`promptId` (Turn boundaries, instead of joining on timestamps), `isSidechain` (subagent
nesting), and `attributionMcpServer` / `attributionMcpTool` / `attributionSkill`
(instead of regex-parsing `mcp__server__tool` names).

The planned changes to `hook_events` — nullable `taskId`, added `sessionId`, `payload`,
`result` — are no longer needed for Trajectory.
The dead health check in the all-tools hooks (`/api/tasks` should be `/tasks`) is still a
real bug for the simple view and is tracked separately.
