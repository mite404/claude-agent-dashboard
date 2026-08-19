# Linear ticket proposal — Trajectory arc

**Status: proposal.** No new issues have been created in Linear.
One *existing* issue (ETH-15) was edited in place during this session — see the note
under "What already exists".

Goal: turn `plans/learning-ladder.md` (the five ordered hands-on tasks) and
`plans/trajectory.md` (the feature those last two tasks are embedded in) into a Linear
backlog the user can look at and see the whole software development lifecycle, not just
the next file to edit.

## What already exists in Linear

Checked via `list_issues` against the **Claude Agent Dashboard** project (team `ETH`,
2026-08-19). Five issues exist. Three of them are ladder steps 1–3, already fully
specified by `plans/001`–`003`:

| Issue | Title | Maps to |
|-------|-------|---------|
| ETH-15 | Fix the dead health check in the PostToolUse-all and PreToolUse-all hooks | Ladder step 1 · plan 002 (scope widened past the plan — see note) |
| ETH-16 | Guard `JSON.parse` in all four hook scripts | Ladder step 2 · plan 003 |
| ETH-14 | Bind dev servers to loopback + reject cross-origin `/spawn` | Ladder step 3 · plan 001 |
| ETH-17 | Attach `hook_events` to `GET /tasks` | Unrelated — see note below |
| ETH-18 | Add a CI gate + typecheck in build | Unrelated — P1 from `docs/IMPROVE.md` |

All five are mirrored to GitHub issues `#56`–`#60` in `mite404/claude-agent-dashboard`,
each titled with its Linear ID.
The mirrors were created 2026-08-19 within seconds of the Linear issues, so the established
pattern for this repo is: file in Linear, mirror to GitHub.
`AGENTS.md` has been corrected to say so — it previously named the wrong repo and pointed at
three `docs/agents/*.md` files that do not exist.

**No new tickets needed for ladder steps 1–3.** They're already well-scoped, single-plan
issues. This proposal only reorders them to the front of the sequence and adds the
Trajectory work after them.

**Update, same session — ETH-15 was edited.** Its scope was narrower than the actual ladder
task: it named `post-tool-all.ts` only, matching plan 002, but `learning-ladder.md` step 1 is
explicit that the identical bug is also in `pre-tool-all.ts` and plan 002 just doesn't mention
it. Edited ETH-15 directly to cover both files (title, Why, Scope, Done-when, Notes) rather
than filing a second ticket for one line of code in a sibling file.

The GitHub mirror `#57` has been synced to match (title and body). Labels are not mirrored —
see `AGENTS.md`.

**ETH-17 is not part of this arc.** It's the `TODO(human)` at `src/server.ts:62`, and
`trajectory.md`'s "What this design does not invalidate" section is explicit that ADR 0001
does not dissolve it — it's a simple-view concern, still tracked, just not something
Trajectory work touches. Leave it where it is.

## Why an epic + sub-issues, not a Linear Project

The repo already has one Linear Project: **Claude Agent Dashboard**. A second project
per feature would fragment a single-repo backlog across project boundaries for no reason.
Using a parent issue (epic) with `parentId` sub-issues keeps everything under the existing
project and gives the hierarchical view the user asked for — one epic, its build steps
underneath, expandable.

## Proposed new issues

One epic, seven sub-issues, all under the existing **Claude Agent Dashboard** project.

`TR-1`–`TR-7` below are **placeholders for readability only.** Linear assigns identifiers
per team, so these will land as `ETH-19` and up. Do not create a `TR` team — that would
fragment the backlog exactly the way the section above argues against.

### Epic: Trajectory — transcript-based audit view

Tracking issue only, no code changes of its own. Description links `plans/trajectory.md`,
`docs/adr/0001-trajectory-reads-the-transcript-not-the-hooks.md`, and `CONTEXT.md`.
Closes when all seven sub-issues close. No effort label — it is not a work item.

### Sub-issues, in build order

| # | Title | Scope | Depends on | Ladder step |
|---|-------|-------|------------|-------------|
| TR-1 | `parseTranscript.ts`: list threads, parse rows, pair `tool_use`/`tool_result`, group into Turns | New file. Mechanical: read `~/.claude/projects/<slug>/*.jsonl`, one parse function, pairing by `tool_use_id`, grouping by `promptId`. No classification logic yet. | — | — |
| TR-2 | `parseTranscript.ts`: classify Context Injection signal vs. noise | Same file, new function. The signal/noise line from `CONTEXT.md` — `hook_additional_context`, `skill_listing`, etc. vs. `hook_success`, `output_style`, `task_reminder` — is a *starting* classification inferred from one transcript; this ticket is validating and refining it against more sessions. | TR-1 | **Ladder step 4** |
| TR-3 | Three Trajectory endpoints + parse cache | `GET /trajectory`, `GET /trajectory/:sessionId`, `GET /trajectory/:sessionId/:rowId` in `src/server.ts`. Cache the parse by file mtime + size so the 3.9 MB raw transcript is never sent to the browser. | TR-1 | — |
| TR-4 | `TrajectoryView.tsx`: port mockup + `USER`/`ASSISTANT`/`CONTEXT` rows + Turn gutter + toolbar | Port `docs/mockups/trajectory.html`, add the three row kinds the mockup doesn't have, add Turn boundary markers in the gutter. Toolbar carries the **noise toggle** and **search** (client-side filter over the projected rows; the mockup already has search markup, the toggle is new). Duration zoom (every row) only — the default view. | TR-3 | — |
| TR-5 | `TrajectoryView.tsx`: Turns and Calls zoom-level collapse | Same file, new function: collapse to Turn boundaries with roll-up counts, and a denser level that keeps Assistant steps but rolls up Tool Calls. Recursive-with-a-density-argument, same shape as `sortNodes` in `TaskTable.tsx`. | TR-4 | **Ladder step 5** |
| TR-6 | Wire Trajectory into Dashboard | `Dashboard.tsx` already has `useState<'table' \| 'board'>`; add `'trajectory'`, a third toolbar button, and the thread picker (filesystem-sourced). | TR-4 | — |
| TR-7 | Task-row breadcrumb into Trajectory | Tool-call count chip per task row (amber/red on failure), linking into Trajectory filtered to that task. Shown only when `sessions.id` matches a transcript filename — silently absent otherwise. | TR-6 | — |

Sub-issues are split at decision boundaries, not by file count — TR-7 in particular touches
the task row *and* whatever routes into a filtered Trajectory. Each is S-effort by the same
yardstick as ETH-14/15/16.

**The two ladder steps are deliberately off the critical path.** TR-3 depends on TR-1, not
TR-2: the endpoint projects rows whatever the classifier decides, so it only needs TR-1's row
shape. TR-6 depends on TR-4, not TR-5: wiring needs a component that renders, and zoom collapse
is a control *inside* one that already does.
That means TR-2 and TR-5 — the two you write by hand, on your own clock — can sit open without
stalling anything, and each lands as an additive enhancement to working code.

## Recommended order (not a hard chain)

1. ETH-15 — dead health check *(exists)*
2. ETH-16 — `JSON.parse` guard *(exists)*
3. ETH-14 — cross-origin `/spawn` *(exists)*
4. TR-1 — transcript parsing, mechanical
5. TR-3 — three endpoints
6. TR-4 — `TrajectoryView.tsx`, Duration zoom + toolbar
7. TR-6 — wire into Dashboard
8. TR-7 — task-row breadcrumb
9. TR-2 — signal/noise classifier — **ladder step 4** *(any time after TR-1)*
10. TR-5 — zoom-level collapse — **ladder step 5** *(any time after TR-4)*

Steps 4–8 are the spine. Steps 9–10 are yours and slot in wherever you want them, as long as
their one dependency has landed.

Trajectory build step 6 ("fix the dead health check") from `trajectory.md` is **the same
bug as ETH-15** — already tracked, already GitHub issue `#57` per that doc. Not duplicated
into a TR ticket.

## Sequencing notes (shared-file conflicts)

Same pattern the repo already uses for 002/003 in `plans/README.md`:

- TR-1 and TR-2 both touch `parseTranscript.ts`. Land TR-1 first — TR-2 adds a function,
  doesn't touch TR-1's code, so it applies cleanly after.
- TR-4 and TR-5 both touch `TrajectoryView.tsx`, same reasoning.
- TR-6 and TR-5 can be in flight at once. TR-6 edits `Dashboard.tsx` and mounts the component;
  TR-5 edits the component's internals. Disjoint files.
- TR-3 and TR-7 are each additions with no overlap against their predecessors beyond the
  dependency itself.

## Open questions for review

- **Label**: existing issues use `hand-code ≤4h`. All seven sub-issues fit under 4h
  individually (`parseTranscript.ts` total estimate is 1.5h split two ways, `TrajectoryView.tsx`
  is 3h split two ways) — propose the same label on the seven, and none on the epic.
- **Priority**: existing three ladder issues are Urgent/High. Propose Medium for the epic
  and all TR sub-issues — this is a new feature, not a live bug or security hole.
- **Cycle**: none of the five existing Dashboard issues are in a cycle. Leave the epic and
  sub-issues uncycled unless the user wants to timebox this arc.
- **GitHub mirrors for the eight new issues.** All five existing Linear issues have one; the
  pattern is Linear-primary, GitHub-mirror, title and body only. Confirm the eight get mirrors
  too, and decide whether the epic gets one or only the seven sub-issues do.
