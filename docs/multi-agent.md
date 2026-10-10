# How several agents share this repository

More than one AI agent works in `Danathar/openaudible-autoupdate`, next to its
owner. This page says which agents, how work reaches them, what keeps them from
colliding, and who decides what lands. [`AGENTS.md`](../AGENTS.md) is the brief
every agent reads first and wins on any disagreement; [`CLAUDE.md`](../CLAUDE.md)
is the codebase guide. This page is about how the agents fit together, not about
how to write the script.

It holds no counts, because they go stale. Where a fact can change, a command
shows the current answer. Every `gh` command passes
`--repo Danathar/openaudible-autoupdate`, so it does the same thing from any
clone or worktree.

## Rule 1: never run the updater for real

`openaudible-autoupdate.sh` ends in `sudo dnf install -y` on a downloaded rpm
(`openaudible-autoupdate.sh:68`). An agent must not run it on the owner's host.
Run it only with stub `curl`, `rpm`, `sudo` and `dnf` first on `PATH`, or inside
a throwaway container. This is the one rule no task is allowed to override.

## There is no dispatcher in this repository

Nothing here decides which agent runs, when, or on what.
[Hive](https://github.com/hivecommons/hive) does that from outside, through a
GitHub App, and its dashboard is not part of this repository. Workflows in
`.github/workflows/` react to ordinary GitHub events (a push, a pull request, a
label, a comment, a schedule); they do not schedule an agent on their own. What
each one does is in
[`ai-ops-runbook.md`](ai-ops-runbook.md#what-each-workflow-does-and-how-to-turn-it-off).

## Who works here

| who | how to recognise it | what it does |
|---|---|---|
| The owner (`Danathar`) | commits and PRs under that login | decides scope and merges |
| Hive agents | PRs and issues from the GitHub App `danathar-atomic-hive` (`gh` prints the author as `app/danathar-atomic-hive`, the REST API as `danathar-atomic-hive[bot]`); the body ends with a line like `— hive: agent=<name>` | pick up issues, open PRs, reply to review |
| Codex connector | review comments from `chatgpt-codex-connector[bot]` | reviews pull requests and grades findings P0 to P3 |
| Local agents | Claude Code or omp sessions in a clone or worktree on the owner's machine; commits carry the owner's git identity | work one issue (or one named group) on one branch, as the owner directs |

Match the Hive login exactly, not "any bot": `github-actions[bot]` also acts
here. Three ways to see who did what:

```bash
# PRs the Hive app opened
gh pr list --repo Danathar/openaudible-autoupdate --state all --author app/danathar-atomic-hive --json number,title,headRefName

# the signature line on one PR
gh pr view <N> --repo Danathar/openaudible-autoupdate --json author,body \
  --jq '.author.login, (.body | split("\n") | map(select(startswith("— hive: "))))'

# reviews left by the Codex connector on one PR
gh api repos/Danathar/openaudible-autoupdate/pulls/<N>/reviews \
  --jq '.[] | select(.user.login == "chatgpt-codex-connector[bot]") | .body'
```

Findings from the Codex connector carry a priority from P0 (blocking) to P3
(minor). Read each one against the code before acting: a finding is a claim to
verify, not an instruction. See [`review-rubric.md`](review-rubric.md) for the
checklist a reviewer, human or agent, applies.

Task traceability, which links a change back to the agent task that produced it,
is described in [`agent-tasks/README.md`](agent-tasks/README.md).

## How work reaches an agent

- **An issue.** Hive reads issues and files its own. The ACMM issues carry the
  title prefix `[ACMM L<n>]`.
- **A label or comment** that a workflow reacts to, such as an `ai-fix-requested`
  label or an `@claude` mention. These are defined by
  `.github/workflows/ai-fix.yml` and `.github/workflows/claude.yml`; read the
  header of each for who may trigger it.
- **Hive's own schedule**, outside this repository. When the repo is paused in
  Hive, its agents stop acting on it (see
  [`ai-ops-runbook.md`](ai-ops-runbook.md#pause-and-resume-the-repository-in-hive)).

## What keeps agents from colliding

There is no lock. Agents work on separate branches; collisions are found by
reading and settled by the owner.

1. **Claim before you start.** Look for an open pull request or a branch that
   already answers the issue, and for a claim comment on it:

   ```bash
   gh pr list --repo Danathar/openaudible-autoupdate --state open --json number,title,headRefName
   gh issue view <N> --repo Danathar/openaudible-autoupdate --comments
   ```

   If another agent holds the issue, do not start a second branch for it. Say
   in your pull request body which files you touch and which open pull requests
   you checked them against.
2. **One branch per issue.** A pull request answers one issue (or one named
   group of issues) and says so with `Closes #N`. Branch names say what they do
   (Hive names its own branches; do not rely on a pattern); the ACMM effort used
   `acmm/<slug>` (see [`agent-tasks/2026-10-10.md`](agent-tasks/2026-10-10.md)).
   Branch from current `origin/main`; do not stack one branch on another.
   Parallel local sessions use one `git worktree` each, so two branches are never
   checked out in the same directory.
3. **Never push to a branch you did not create.** That includes another agent's
   branch and an outside contributor's. Comment instead.
4. **Keep shared files small and deliberate.** This repository is one script, so
   conflicts concentrate in a few places:
   - **`openaudible-autoupdate.sh`** is the product and the one file almost every
     behaviour change touches. Only one open pull request at a time should
     change its logic; a second one waits or rebases onto the first. The tests
     in `tests/` pin its behaviour with stubbed commands, so a rebase that
     passes them has kept the contract.
   - **`README.md`** documents that script (install, configuration variables,
     usage). A change to an environment variable (`VERSION_URL`, `PKG_NAME`,
     `PLATFORM_KEY`) or to what the script does changes the README table and
     steps in the same pull request.
   - **`systemd/openaudible-autoupdate.service` and `.timer`** change only in a
     pull request that exists to change them, because users copy these files.
   - **`AGENTS.md`, `CLAUDE.md` and `.github/workflows/ci.yml`** change only in a
     pull request that exists to change them; they steer every other agent and
     every merge.
5. **Rebase, do not merge `main` into your branch.** If `main` moved, rebase and
   re-run the checks that matter for your change.

## Who decides what lands

No agent merges its own pull request unless the owner has set that up.

- **Required checks.** The checks meant to gate a merge are the jobs in
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). They run on every
  pull request. The ruleset recorded in `.github/rulesets/main.json` and
  explained in [`branch-protection.md`](branch-protection.md) (issue #42) names
  the exact job names and whether branches must be up to date; read it there
  rather than copying names into other docs. Check what is live with
  `gh api repos/Danathar/openaudible-autoupdate/rulesets --jq '.[] | [.name, .enforcement] | @tsv'`.
- **Serialized merging (issue #42).** Hive merges this repository through its
  serialized lane (`merge_strategy: hive-serialized`): one pull request at a
  time, each brought up to date with `main` and re-tested before it merges. Read
  the current value with an authenticated
  `GET /api/repos/merge-strategy?repo=openaudible-autoupdate` on the Hive
  dashboard API. GitHub's native merge queue is not available to a
  personal-account repository, which is why the lane lives in Hive rather than in
  a workflow here.
- **Green is only trusted on a current branch.** A pull request that passed
  before `main` moved has not been tested against today's `main`. Rebase first.
- **A merge reaches users.** The README tells users to copy
  `openaudible-autoupdate.sh` from a clone into `~/bin`, and the timer runs it
  unattended with `sudo`. Whatever is on `main` is what the next person who
  copies it gets, so a bad merge is a bad update. That is the reason for the
  serial lane and for the runbook's
  [bad update](ai-ops-runbook.md#a-bad-update-reached-users) section.
- **An agent's permission boundary needs the owner.** Changes to
  `.claude/settings.json`, `.claude/hooks/**`, `policies/` or
  `.github/CODEOWNERS` are read and merged by the owner, whoever wrote them. An
  agent must not widen its own boundary
  ([`agent-boundaries.md`](agent-boundaries.md),
  [`security/SECURITY-AI.md`](security/SECURITY-AI.md)).
- **Risk tiers set how hard the owner looks.** See
  [`risk-tiers.md`](risk-tiers.md).

## If you are an agent

1. Read [`AGENTS.md`](../AGENTS.md), then [`CLAUDE.md`](../CLAUDE.md).
2. Pass `--repo Danathar/openaudible-autoupdate` on every `gh` command.
3. Claim the issue, branch from `origin/main`, one branch per issue.
4. Never run `openaudible-autoupdate.sh` for real; stub the commands.
5. Run the checks for the files you changed; say in the PR which you ran and
   which you did not.
6. Leave the merge to the lane and the owner.
