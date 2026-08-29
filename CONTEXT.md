# Context

Glossary for the Claude Agent Dashboard domain.
Terms here are the shared language. Implementation lives in code, not in this file.

## Trajectory

The chronological record of every tool the agent invoked, and what came back.

Its purpose is **debugging a single run that went wrong** — not aggregate analytics,
and not a compliance record.
That purpose is the tiebreaker for every Trajectory design question:
if a feature does not help someone answer "why did that run fail?", it does not belong.

Trajectory is a diagnostic view, not the default view.
The default view answers "what is the agent doing?"
Trajectory answers "what exactly did it do, in order?"

## Conversation Thread

One continuous exchange between a person and the agent, from first prompt to last.

The Thread is [Trajectory](#trajectory)'s scope. Always.
Trajectory shows every decision and every action the agent took within one Thread —
never a slice of one, never several at once.

[Turn](#turn) and [Step](#step) are zoom levels _within_ a Thread, not alternative scopes.

## Turn

One prompt from the person, and everything the agent did before handing control back.

A Thread is a sequence of Turns.
Turns are numbered for the reader — "Turn 1", "Turn 2" — because "the thing I asked
third" is how people actually locate a moment.

## Step

One move the agent made inside a [Turn](#turn): a piece of reasoning, or a
[Tool Call](#tool-call).

Steps are what the person is scanning when they ask "where did it go wrong?"
A Turn that took nine Steps and sixteen Tool Calls is legible as that summary;
expanding it shows the Steps in order.

## Context Injection

Something added to the agent's knowledge or capabilities mid-[Thread](#conversation-thread)
that the person did not type: a runtime snapshot, a skill catalog, a change in available
tools or permissions.

Context Injections earn a row in [Trajectory](#trajectory) because they explain behaviour
that otherwise looks unmotivated — the agent suddenly knowing something, or suddenly being
able to do something.

The test is whether the agent's knowledge or capabilities _changed_.
Machinery reporting that it worked is not a Context Injection, and is hidden by default.

## Tool Call

One invocation of one tool by the agent, from request to response.

A Tool Call is the unit a person reasons about: "it read that file", "it ran that command".
It is the row in [Trajectory](#trajectory).

Distinct from a **Hook Event** — the notification the Claude Code harness emits when
a tool starts or finishes.
Every Tool Call produces two Hook Events, `pre` and `post`.
The pair describes one Tool Call, so Trajectory shows one row, not two.

## MCP Call

A [Tool Call](#tool-call) served by an external MCP server rather than a built-in tool.

Named `mcp__<server>__<tool>` by the harness.
Worth distinguishing because it leaves the machine — a slow or failing MCP Call has a
different cause, and a different fix, than a slow built-in tool.
