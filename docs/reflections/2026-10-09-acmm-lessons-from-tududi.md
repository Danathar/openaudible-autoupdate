# What the same ACMM rollout on tududi taught, applied here before starting

**Date:** 2026-10-09
**Context:** the fifty `[ACMM ...]` issues on this repository are being worked
as parallel slices, one PR each (`Danathar/openaudible-autoupdate#51` to
`#56`, plus the one that adds this file). The owner's repository
`Danathar/tududi` went through the same set of issues a few hours earlier; its
merged results were the starting material. This is what that run showed, with
the evidence on tududi's side.

## What happened

- **CI service image rate limit.** `Danathar/tududi#58`: `test-postgres`
  failed on every pull request opened that day (`#49` to `#57`) at "Initialize
  containers", before any test ran, with `toomanyrequests: You have reached
  your unauthenticated pull rate limit` from Docker Hub. The fix switched the
  service image to Amazon ECR Public's mirror of the same Docker Hub image
  (merged as `5306e5b8`, 2026-10-09T21:40Z). Nine PRs had been opened against a
  check that could not pass for a reason unrelated to any of them.
- **Whack-a-mole on a regex guard.** `Danathar/tududi#53` (the `guard-bash.mjs`
  hook, issues #21, #22, #24 there) has 12 commits, 8 of them `fix(hooks): ...`.
  Codex review comments arrived one failing example at a time (P1 unless noted):
  `gh discussion` treated as an unknown group; `origin` re-pointed to a
  non-upstream URL; `sh -c -- '...'`; `gh api graphql --input file`; repeated
  `--repo` flags where gh honours the last; `git remote remove origin && git
  remote add origin ...`; a PR created without `--base main` (P2); `git -c
  remote.origin.pushurl=...`; `env -S '...'`; `gh alias set` followed by the
  alias. Each was fixed with a test. The reply that settled the last one
  records the decision: the fix was to fail closed for unlisted `gh` groups, so
  alias resolution became moot, and the hook's threat model, documented at the
  top of `guard-bash.mjs`, is "accidental/careless misuse, not deliberate
  obfuscation". It merged as `734029db` (2026-10-09T22:52Z). `Danathar/tududi#60`
  then closed two more gaps in `checkGitConfig` found in review of `#53`
  (`--value`/`--url` value words read as the key; `rename-section` checking only
  the old name), merged as `7f5df4f9`.
- **Review quota ran out mid-rollout.** On `Danathar/tududi#53` the owner
  posted `@codex review` three times; at 22:07Z the connector replied that the
  Codex usage limit for code reviews had been reached. The same reply appears
  on `Danathar/tududi#60` at 23:01Z, which has no Codex review.
- **Here.** This repository's hook started from tududi's merged
  `guard-bash.mjs` and its tests, so the lessons above were inherited rather
  than rediscovered: the threat model heads the file, unknown `gh` groups fail
  closed, and `git config`/`git remote`/`env -S` are covered from the start.
  What is specific to this repository is a second job: refusing to run the
  updater, `sudo` or package installs on the host. Its one exemption, "run it
  with stubs", is defined by what can be checked on disk: the first `PATH`
  entry must be a directory inside the project, under `tests/`, holding
  executable `sudo`, `dnf` and `rpm`, so `PATH=tests/empty:$PATH
  ./openaudible-autoupdate.sh` is blocked when `tests/empty` has no stubs.
  `.claude/hooks/tests/guard-bash.test.mjs` has a case for each way that check
  can fail.

## What it shows

- A check that depends on a third-party service's anonymous quota (Docker Hub
  pulls) fails for everyone at once and says nothing about the change under
  review. It is cheap to prevent and expensive to hit in the middle of a
  burst of PRs.
- A guard written by adding one rule per failing example does not converge
  quickly; the review rounds on `#53` found a new bypass each time, at the
  cost of eight fix commits. Writing the threat model first (what the guard is
  for and what it is not for) turned "is this bypass in scope?" into a
  question with an answer, and the fail-closed allowlist replaced a class of
  cases with one rule.
- Automated review is a metered resource. When it runs out, the PR's remaining
  changes are reviewed by nobody unless someone says so. [INFERENCE] The two
  PRs where it ran out are the two that changed the hook, which is the part of
  the work most in need of review.

## What to do next time

- Do not use Docker Hub for CI service containers or base images when the same
  image is published elsewhere (ECR Public's `public.ecr.aws/docker/library/`,
  `registry.fedoraproject.org`, GHCR). The foundation PR for this repository
  (`Danathar/openaudible-autoupdate#54`) pulls `registry.fedoraproject.org/fedora:latest`
  in its CI and e2e runs, not a Docker Hub image.
- Write the guard's threat model before its rules, put it at the top of the
  file, and make unknown input fail closed (allowlist, not blocklist). When a
  review finds a bypass, ask which rule class it belongs to before adding a
  case.
- State in the PR which changes were not reviewed when automated review is
  unavailable, and ask for a human look at the safety-relevant ones (hook,
  workflows, permissions) first.
- Define every exemption by something that can be checked on disk (a stubs
  directory that exists and contains the stubs), not by a name that an
  argument can merely mention.
