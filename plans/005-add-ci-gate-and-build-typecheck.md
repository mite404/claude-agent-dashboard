# Plan 005: Add a CI gate and put typecheck in the build script

> **Executor instructions**: This is a **learning plan**. Unlike plans 001–004,
> the Steps below deliberately do **not** hand you the finished YAML or the
> finished `package.json` line — they contain stubs with `TODO(you)` blanks and
> the acceptance criteria to check your own answer against. Hints live in
> collapsed `<details>` blocks; open them only after you are properly stuck. Run
> every verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Linear**: [ETH-18](https://linear.app/mite404-workspace/issue/ETH-18/add-a-ci-gate-and-put-typecheck-in-the-build-script) · GitHub `claude-agent-dashboard#60`
>
> **Drift check (run first)**:
> `ls -d .github 2>/dev/null; grep -n '"build"' package.json`
> Expected: `ls` prints nothing (no `.github` directory), and `build` is exactly
> `"build": "vite build"`. If either has changed, compare "Current state" against
> the live files before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (~2h — the YAML is short, the decisions in Step 2 are not)
- **Risk**: LOW to runtime, MEDIUM to your own workflow. A CI gate that is wrong
  in either direction is expensive: too loose and it proves nothing, too strict
  and you will start bypassing it.
- **Depends on**: none. Plans 001–003 are DONE; this protects them.
- **Category**: DX, regression protection
- **Planned at**: `gitbutler/workspace`, 2026-08-24
- **Covers finding**: #5 (DX-01 + DX-02, P1) from `docs/IMPROVE.md:85-93` — the
  batch `plans/README.md` names under "Not yet planned"
- **Learning goals**: TypeScript project references vs. `--noEmit`, what a
  tsconfig `exclude` actually costs you, designing a gate around the checks that
  already pass

## Why this matters

Two holes, one shape.

**DX-02.** `package.json:8` is `"build": "vite build"`. `AGENTS.md:27` claims the
build does a "TypeScript check". It does not — `vite build` transpiles via esbuild
and discards types without looking at them. Type-broken code builds clean and
ships.

**DX-01.** There is no `.github/` directory. Nothing runs `tsc`, `oxlint`, or
`vitest` on a push or a pull request. Test coverage just landed in #54 and #55 —
133+ tests — and nothing enforces them, so they will rot at the speed of the next
busy week.

`docs/IMPROVE.md:91-93` puts the fix immediately after the P0 batch precisely so
those P0 fixes cannot silently regress. Plans 001, 002 and 003 each closed a real
bug. Nothing currently stops plan 006 from reopening one.

The whole toolchain is already clean. CI does not need to _fix_ anything here —
it needs to _pin_ what is already true.

## Current state

`package.json` scripts, the relevant ones:

```json
"build":        "vite build",
"lint":         "oxlint .",
"lint:css":     "stylelint '**/*.css'",
"lint:md":      "rumdl check .",
"format:check": "oxfmt --check",
"test":         "vitest",
"smoke":        "bun scripts/smoke-test.ts"
```

Note `"test": "vitest"` — bare `vitest` starts **watch mode**. In CI that hangs
until the job times out. This is the single most common way a first CI attempt
fails, and it will not look like a type error when it happens.

`tsconfig.json` is a **solution file**:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`tsconfig.app.json` sets `"noEmit": true`, `"include": ["src", "./vitest-setup.ts"]`,
and — read this line twice —

```json
"exclude": ["src/server.ts", "src/db"]
```

The Hono server and the Drizzle layer are **not typechecked today**. That is the
interesting part of this plan and the reason Step 2 exists.

Package manager is Bun (`bun.lock`, no `package-lock.json`). Vitest config lives
in `vite.config.ts` under the `test` key, with `environment: "jsdom"`, `globals:
true`, `ui: true`, and `setupFiles: ["./vitest-setup.ts"]`.

## Commands you will need

| Purpose                  | Command                         | Expected on success                  |
| ------------------------ | ------------------------------- | ------------------------------------ |
| Install (CI-shaped)      | `bun install --frozen-lockfile` | exit 0                               |
| Typecheck — **naive**    | `bunx tsc --noEmit`             | see Step 1; the result is the lesson |
| Typecheck — project refs | `bunx tsc -b`                   | exit 0, no errors                    |
| Lint                     | `bun run lint`                  | exit 0 (pre-existing warnings OK)    |
| CSS lint                 | `bun run lint:css`              | exit 0                               |
| Markdown lint            | `bun run lint:md`               | exit 0                               |
| Format check             | `bun run format:check`          | exit 0                               |
| Tests, **non-watch**     | `bunx vitest run`               | `133 passed` or higher               |
| Build                    | `bun run build`                 | exit 0                               |
| Count typechecked files  | see Step 2                      | a number you can justify             |

Run every row **before** you write any YAML. A CI job that fails on something
that was already broken locally teaches you nothing about CI.

## Scope

**In scope**:

- `.github/workflows/ci.yml` (new)
- `package.json` — the `build` script, and possibly one new script
- `plans/README.md` — status row

**Out of scope** (do NOT touch):

- **`tsconfig.app.json`'s `exclude` line.** Step 2 asks you to _measure_ what it
  costs and _record_ the answer. Actually removing the exclusion will surface an
  unknown number of pre-existing errors in `src/server.ts` and `src/db`, which is
  its own ticket with its own risk. Do not fold it into a CI plan.
- **Any source file.** If CI is red because of real code errors, that is a
  finding to report, not a thing to fix inside this plan.
- **`AGENTS.md:27`'s false claim** that build typechecks. It becomes true when
  you finish, which is a happy accident, not a scope item.
- **Deploy, release, or publish workflows.** One workflow, on pull request.
- **Branch protection rules on GitHub.** Configuring the repo to _require_ the
  check is a GitHub settings change, not a file. Note it in Maintenance.

## Git workflow

- Branch: `mite404/eth-18-ci-gate`
- Commit message: `ci: add PR gate and typecheck the build`
- Do NOT push or open a PR unless the operator instructed it — though note that
  this plan's Done criteria cannot be fully verified without one open PR. See
  Test plan.

## Background: the gate and the guardrail

Two different things get called "CI" and they behave differently.

A **guardrail** is on your side of the workflow. `bun run build` failing on your
machine is a guardrail: it stops you before you have made anyone else's problem.
Fast, local, easy to bypass on purpose.

A **gate** is on the shared side. It runs on the pull request, after you have
stopped paying attention, and it is the last thing standing between a mistake and
`main`. Slower, remote, and its whole value comes from _not_ being bypassable.

DX-02 is the guardrail. DX-01 is the gate. They should check the same things, and
you want the guardrail to be a strict subset of the gate — so that "it built
locally" is never a surprise on the PR.

The trap is building a gate that checks less than it appears to. A green
checkmark is a claim, and an unearned claim is worse than no claim, because now
people rely on it. The `exclude` line in `tsconfig.app.json` is exactly this
problem in miniature, which is why Step 2 comes before Step 3.

## Steps

### Step 1: Find out what "typecheck" actually means in this repo

`docs/IMPROVE.md:91` says to change `build` to `tsc --noEmit && vite build`. Try
it — literally, at the command line, before editing anything:

```bash
bunx tsc --noEmit
echo "exit=$?"
```

Now run:

```bash
bunx tsc -b
echo "exit=$?"
```

**They do not do the same thing here.** Work out why before reading further. The
relevant facts are all in `tsconfig.json`: `"files": []` and a `references`
array, with no `include`.

Write down, in one sentence each:

```text
`tsc --noEmit` against this repo's tsconfig.json typechecks:  ______ files
`tsc -b` against this repo's tsconfig.json typechecks:        ______ files
The reason for the difference is:                             ____________
Therefore the IMPROVE.md recommendation is:                   correct / subtly wrong
```

**Quiz:**

1. `tsconfig.json` has `"files": []`. What does a compiler asked to check zero
   files report, and what exit code does it use?
2. `tsconfig.app.json` already sets `"noEmit": true`. Given that, what is the
   `--noEmit` flag on the command line doing for you? Anything?
3. `tsc -b` writes a `.tsbuildinfo` file (see `tsBuildInfoFile` in
   `tsconfig.app.json`). What does that mean for a CI run on a fresh machine
   versus your second local run? Which one is slower, and does it matter?

<details>
<summary>Hints for Step 1</summary>

- `--noEmit` runs a plain compile against the config's own file list. With
  `"files": []` and no `include`, that list is empty. An empty compile succeeds.
- `-b` is build mode. It reads `references` and builds each referenced project.
  That is how a solution-style tsconfig is meant to be driven.
- Q3: `.tsbuildinfo` is an incremental cache under `node_modules/.tmp/`. CI
  starts clean every time, so CI always pays full price. Whether that matters
  depends on how long full price is — time it.

</details>

**Verify**: you can state which of the two commands is the real gate and why, and
your answer does not depend on `docs/IMPROVE.md` being right.

### Step 2: Measure what the tsconfig `exclude` costs

`tsconfig.app.json` excludes `src/server.ts` and `src/db`. Both are load-bearing:
the Hono server is the entire API surface the hook scripts talk to, and `src/db`
is the Drizzle layer underneath it.

So even a correct `tsc -b` leaves them unchecked, and a CI badge that says
"typecheck ✅" will be making a narrower claim than a reader assumes.

Find out how much narrower. You need two numbers:

```text
Files typechecked today by `tsc -b`:                    ______
Files that WOULD be typechecked without the exclude:    ______
Errors that appear if the exclude is lifted:            ______
```

For the first two, `tsc` can list its own file set — look for the flag that makes
it print the files it resolved rather than compiling them. For the third, make a
**throwaway** copy of the config, lift the exclusion there, point `tsc` at the
copy, and count. Delete the copy. Do not modify `tsconfig.app.json` itself; that
is out of scope and named in STOP conditions.

Record all three numbers in the workflow file as a comment (Step 3 has a slot for
it). This is the honest-badge move: the gate does not cover `src/server.ts`, and
the next person deserves to learn that from the workflow rather than from an
outage.

**Quiz:**

1. Why might `src/server.ts` and `src/db` have been excluded in the first place?
   Look at the `types` array and `lib` in `tsconfig.app.json` — what runtime does
   that config describe, and what runtime does `src/server.ts` target?
2. `tsconfig.node.json` exists and is referenced. Read it. Does it cover
   `src/server.ts`? If not, is anything checking that file at all?
3. If the answer to (2) is "nothing", what is the cheapest honest thing this plan
   can do about it — fix it, or write it down? Justify in one sentence.

<details>
<summary>Hints for Step 2</summary>

- The flag that lists resolved files without compiling is `--listFiles`, or
  `--listFilesOnly` for just the paths. Pipe to `wc -l`.
- Q1: `tsconfig.app.json` has `"lib": ["ES2020", "DOM", "DOM.Iterable"]` and
  `"jsx": "react-jsx"`. That is a browser config. `src/server.ts` runs under Bun
  and imports Hono — different globals, different module resolution.
- Q3: "Write it down" is a legitimate answer here and probably the right one.
  Lifting the exclusion means either fixing N pre-existing errors or splitting a
  third tsconfig project — both larger than this plan and both worth their own
  ticket. A comment in the workflow plus a line in Maintenance notes is cheap and
  keeps the badge honest.

</details>

**Verify**: three numbers written down, `tsconfig.app.json` unmodified
(`git diff --stat tsconfig.app.json` is empty), and no throwaway config left in
the tree.

### Step 3: The workflow stub

Create `.github/workflows/ci.yml`. Fill in every `TODO(you)`.

```yaml
name: CI

# TODO(you): trigger. The ticket says "on pull request".
#   - Which event name, and do you want a branch filter?
#   - Should it ALSO run on push to the default branch? Argue both ways before
#     picking: what does it buy you that the PR run does not, given that this
#     repo's default branch is `gitbutler/workspace` and work lands via PR?
on:
  # TODO(you)

# TODO(you): concurrency.
#   Three pushes to the same PR in five minutes should not run three full jobs.
#   There is a top-level key for this that takes a `group` and a boolean.
#   What should `group` be so that two DIFFERENT PRs never cancel each other?

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      -  # TODO(you): check out the repo. Use the official first-party action.


      -  # TODO(you): set up Bun. This repo has bun.lock and no package-lock.json.
        #   The community action is `oveleon/setup-bun` or `oven-sh/setup-bun` —
        #   check which one is current before you pin it, and pin a version.

      - name: Install
        # TODO(you): install from the lockfile WITHOUT letting it drift.
        #   npm's equivalent is `npm ci`. Bun has a flag that does the same job.
        #   If the lockfile and package.json disagree, this step must FAIL, not
        #   silently resolve. That is the whole point.
        run: # TODO(you)

      - name: Typecheck
        # TODO(you): use whichever of the two commands from Step 1 is the real
        #   gate. Not the one IMPROVE.md suggests, unless Step 1 concluded it was
        #   right.
        #
        #   Coverage note from Step 2 — fill these in as a comment so the badge
        #   is honest:
        #     files checked here: ___
        #     NOT checked (tsconfig.app.json exclude): src/server.ts, src/db
        #     errors if that exclusion were lifted: ___  (tracked separately)
        run: # TODO(you)

      - name: Lint
        # TODO(you): `lint` is oxlint. There are also lint:css and lint:md and
        #   format:check. Decide which belong in the gate.
        #   Ask yourself for each: if this fails, should the PR be blocked?
        #   A formatting failure and a type error are not the same severity, and
        #   you can express that (see the `continue-on-error` key) — or you can
        #   decide they ARE the same and block on both. Either is defensible;
        #   pick on purpose and leave a one-line comment saying why.
        run: # TODO(you)

      - name: Test
        # TODO(you): DANGER. `bun run test` is `vitest`, which is WATCH MODE and
        #   will hang this job until it times out. Use the non-watch invocation.
        #   Consider also adding a `test:ci` script to package.json so this trap
        #   cannot be stepped in again from any other caller.
        run: # TODO(you)

      - name: Build
        # TODO(you): after Step 4, `build` includes the typecheck. Is running it
        #   here redundant with the Typecheck step? Redundant is not automatically
        #   bad — say what it catches that the earlier steps do not.
        run: # TODO(you)
```

<details>
<summary>Hints for Step 3</summary>

- **Trigger**: `pull_request` is the gate. Adding `push` to the default branch
  catches direct pushes that bypass PRs — worth it only if that happens here.
  Check `git log --merges -5` to see how work actually lands.
- **Concurrency**: `group: ${{ github.workflow }}-${{ github.ref }}` plus
  `cancel-in-progress: true`. `github.ref` differs per PR, so PRs cannot cancel
  each other.
- **Checkout**: `actions/checkout@v4`.
- **Bun install**: the frozen-lockfile flag. It is in the Commands table above.
- **Vitest**: the non-watch invocation is in the Commands table above too.
- **Severity**: `continue-on-error: true` on a step makes it report without
  blocking. Useful for `lint:md` if markdown nits would otherwise stop a hotfix.
  Note that a step with `continue-on-error` still shows as passed at the job
  level, which is its own honesty problem — decide whether you care.

</details>

**Verify**: `bunx --bun yaml-lint .github/workflows/ci.yml` if you have it, or
simply that GitHub's YAML parser accepts it once pushed. Locally, confirm each
`run:` line you wrote succeeds when pasted into your own shell.

### Step 4: Put the typecheck in `build`

One line in `package.json`. The current value is `"vite build"`.

```json
"build": "TODO(you)"
```

Constraints your answer must satisfy:

- Uses whichever typecheck command Step 1 established is the real one.
- Fails **before** `vite build` runs, not after. Chaining operator matters: `&&`
  and `;` behave differently on failure, and only one of them is right.
- Still works when invoked as `bun run build` from CI and from your shell.

**Verify** — this is the acceptance test for DX-02, and you must actually run it:

1. Introduce a deliberate type error in a file that `tsc -b` covers. For example,
   in any file under `src/components/`, assign a `string` to a variable annotated
   `number`.
2. `bun run build` → **must exit non-zero**, and the error text must name your
   file.
3. Remove the error. `bun run build` → exits 0.
4. Now introduce a type error in `src/server.ts` instead. `bun run build` →
   **exits 0**, because of the `exclude` from Step 2. Confirm this, and confirm
   your workflow comment says so. Remove the error.

Step 4.4 is the one people skip. It is the difference between knowing your gate's
coverage and assuming it.

### Step 5: Update `plans/README.md`

Add a row for plan 005 to the status table, matching the existing format
(Plan / Title / Priority / Effort / Depends on / Status). Also update the
"Not yet planned" section — it currently names "#5 (CI + build typecheck)" as a
good next batch, and that is no longer true.

## Test plan

Local, all of these before you push:

1. `bunx tsc -b` → exit 0
2. `bun run lint` → exit 0
3. `bun run lint:css` → exit 0
4. `bun run lint:md` → exit 0
5. `bun run format:check` → exit 0
6. `bunx vitest run` → `133 passed` or higher, and it **terminates on its own**
7. `bun run build` → exit 0
8. The four-part deliberate-error test from Step 4

Remote — this plan cannot be fully verified without one PR:

9. Push the branch and open a draft PR. The workflow appears and goes green.
10. Push a commit containing a deliberate type error in a covered file. The
    workflow goes **red**, and the failing step is Typecheck.
11. Revert that commit. Push a commit that breaks a test instead. The workflow
    goes red, and the failing step is Test.
12. Revert. Confirm green. Close or continue the PR as the operator directs.

Steps 10 and 11 are the ticket's actual Done criteria ("a PR with a type error
fails CI", "a PR with a failing test fails CI"). A green first run proves the
YAML parses. It does not prove the gate gates.

## Done criteria

Machine-checkable except where noted. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists and is valid YAML
- [ ] `grep -c "TODO(you)" .github/workflows/ci.yml` returns `0`
- [ ] The workflow triggers on `pull_request`
- [ ] The workflow has a `concurrency` block whose `group` includes `github.ref`
- [ ] The install step uses a frozen/immutable lockfile flag
- [ ] The test step does **not** invoke bare `vitest` (watch mode) —
      `grep -n "vitest" .github/workflows/ci.yml` shows a non-watch invocation
- [ ] The Typecheck step's command matches your Step 1 conclusion
- [ ] The workflow contains a comment recording what the typecheck does **not**
      cover, with the file counts from Step 2
- [ ] `package.json` `build` runs a typecheck before `vite build`, joined by `&&`
- [ ] `bun run build` exits non-zero on a deliberate type error in `src/components/`
      (Step 4 test, run it)
- [ ] `git diff --stat tsconfig.app.json` is empty
- [ ] `bunx vitest run` still reports the same test count as before this plan
- [ ] `plans/README.md` has a row for 005 and the "Not yet planned" section no
      longer lists #5
- [ ] (Remote, judgement) Test-plan steps 10 and 11 both observed red on a real PR

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check finds an existing `.github/` directory, or `build` is not
  `"vite build"`.
- `bunx tsc -b` fails on a clean tree **before** you change anything. That is a
  pre-existing type error and it is a separate finding — CI cannot be added on
  top of a red baseline, and silencing it to get green would defeat the plan.
- `bunx vitest run` fails on a clean tree. Same reasoning.
- You conclude the right move is to remove the `exclude` from `tsconfig.app.json`.
  It may well be, but it is out of scope here (see Step 2 Q3) and belongs in its
  own ticket with its own error count.
- The CI run is green but Test-plan step 10 does not turn it red. Your gate is
  decorative. Do not mark this plan DONE.

## Maintenance notes

- **Branch protection is not in this plan.** The workflow _reports_; making it
  _required_ is a GitHub repository setting (Settings → Branches → require status
  checks). Until that is switched on, the gate is advisory. Someone should do it;
  it is a click, not a file, so it cannot live in a commit.
- The coverage comment in `ci.yml` is a snapshot. If `tsconfig.app.json`'s
  `exclude` is ever changed, that comment becomes a lie — a reviewer touching
  that line should update it.
- `AGENTS.md:27` claims the build does a TypeScript check. After Step 4 that
  becomes true for the first time. No edit needed, but worth knowing it was
  aspirational until now.
- The next natural follow-ups from `docs/IMPROVE.md`, once this gate exists, are
  #6 (log-writer append race) and the server-test gap — both get materially
  safer with a working CI.
- If job time becomes annoying, the first thing to cache is Bun's install, not
  the TypeScript build — `.tsbuildinfo` caching across runs is fiddly and the
  full typecheck here is small.

## What you should know afterwards

1. A solution-style `tsconfig.json` (`files: []` + `references`) makes
   `tsc --noEmit` a no-op that exits 0. Build mode `-b` is what actually drives it.
2. An `exclude` in a tsconfig is invisible at the call site — the command still
   says "typecheck" and still passes.
3. `"test": "vitest"` is watch mode. Any CI step that calls it hangs, and the
   failure looks like a timeout rather than a mistake.
4. A gate's value is entirely in what it blocks. Prove it blocks something, once,
   by breaking it on purpose.
5. When a check covers less than its name implies, the cheap honest fix is to
   write the gap down next to the check, not to quietly widen the name.
