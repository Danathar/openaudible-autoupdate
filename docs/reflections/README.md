# Reflections

A reflection is a dated, short account of how a piece of work in this
repository actually went, and what to do differently next time. It is for
patterns in the work itself, not for facts about the code.

**Host rule.** `openaudible-autoupdate.sh` runs `sudo dnf install -y`; agents
never run it, `sudo` or a package install on the host (stubs on `PATH` from
`tests/`, or `podman run`). Pull requests and issues go to
`Danathar/openaudible-autoupdate` (`--repo Danathar/openaudible-autoupdate`).

## Where things go

| Place | Holds | Lifetime |
|---|---|---|
| [AGENTS.md](../../AGENTS.md) | standing rules | durable |
| [.claude/memory/](../../.claude/memory/README.md) | one specific mistake and its rule | until no longer true |
| [.claude/session-summary.md](../../.claude/session-summary.md) | what is in flight now | overwritten each session |
| this directory | recurring patterns in how the work goes | dated, kept |

Example of the split: "`log()` ends in `cmd && cmd`, which fails under
`set -e`" is a correction (memory). "A guard written one failing example at a
time keeps leaking; write down what it is for first" is a reflection.

## When to write one

- After a PR where review or CI found something the author's own checks missed.
- After an incident, a revert, or a surprise during a rollout.
- When the same kind of problem has come up twice.

Do not write one for routine work that went as planned.

## Format

File name `YYYY-MM-DD-<topic>.md`. Sections:

```markdown
# <title>

**Date:** YYYY-MM-DD
**Context:** which PRs/issues/commits this is about

## What happened
Observed events only, each with a PR, commit or file reference.

## What it shows
The pattern, stated as narrowly as the evidence allows.

## What to do next time
Concrete practices. If one hardens into a standing rule, move it to AGENTS.md.
```

Rules: no event that cannot be traced to a PR, commit or file; mark guesses as
`[INFERENCE]`; link to the evidence instead of retelling it; delete or amend an
entry that later proves wrong. If a reflection produces a specific do/don't,
also add a correction in `.claude/memory/`. PRs and issues in other
repositories are written `Owner/repo#N`.

## Index

| Entry | Subject |
|---|---|
| [2026-10-09-acmm-lessons-from-tududi](2026-10-09-acmm-lessons-from-tududi.md) | What the same ACMM rollout on `Danathar/tududi` taught, applied here before starting |
