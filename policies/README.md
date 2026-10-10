# Policies as code

JSON policies that `node scripts/check-policies.mjs` evaluates against the
repository tree. The `policy-check` workflow
([`.github/workflows/policy-check.yml`](../.github/workflows/policy-check.yml))
runs it on every pull request and push to `main`. Tests are in
[`scripts/tests/check-policies.test.mjs`](../scripts/tests/check-policies.test.mjs)
(`node --test scripts/tests/check-policies.test.mjs`).

Changing a policy is a Tier 1 change in [docs/risk-tiers.md](../docs/risk-tiers.md)
and needs the owner. Why these policies exist, and what the script itself does
and does not defend against, is in
[docs/security/SECURITY-AI.md](../docs/security/SECURITY-AI.md).

## repo-target.json

Stops agent instructions from sending work to the wrong repository.

- Every file that exists and matches `directionGlobs` must contain the literal
  `--repo Danathar/openaudible-autoupdate`. Globs for files that do not exist
  are ignored.
- In those files and in every `.md` under the repository root, `docs/`,
  `.github/`, `.claude/` and `policies/` (`scanGlobs`), each
  `gh pr|issue|release|workflow|label` write command (`create`, `comment`,
  `edit`, `close`, `reopen`, `merge`, `review`, `delete`, `run`, and the others
  in `writeCommandPattern`) and the `rerun`, `cancel` and `delete` verbs of `gh run` must carry
  `--repo Danathar/openaudible-autoupdate`, or `-R Danathar/openaudible-autoupdate`,
  on the same logical line (an environment variable is not enough in
  markdown). A command continued with a trailing backslash is one line. There
  is no exemption for prose: describe an unscoped command in words, or add the
  flag.
- No scanned line may pass `--repo`/`-R` for another repository to a `gh`
  write command, set `GH_REPO=` to another repository, or run
  `gh repo set-default` for another repository. Read-only links to other
  repositories are allowed.
- `excludeGlobs` is empty on purpose. Add an exemption only with a reason.

## workflow-permissions.json

For every `.github/workflows/*.yml`:

- a top-level `permissions:` block is present, so the token never gets the
  repository default, and it grants no write (`write-all` or `<scope>: write`
  is rejected; grant write on the job that needs it);
- `pull_request_target` is not used;
- every `uses:` outside `actions/` and `github/` is pinned to a 40-character
  commit SHA (keep the tag in a trailing `# vX` comment); local `./` and
  `docker://` references are skipped;
- every logical line that runs a `gh` write command passes `--repo`/`-R` with
  `Danathar/openaudible-autoupdate` or `${{ github.repository }}`; or passes
  `"$GH_REPO"`, or nothing, when `env:` of that command's own step, its job or
  the workflow sets `GH_REPO` to one of those values. Scope follows the YAML
  block, so a `GH_REPO` in another job or step does not count. Any other
  `GH_REPO` or `--repo` value fails;
- a command-local `GH_REPO=<value>` before a `gh` write command (including
  `env GH_REPO=<value> gh ...`) must itself be an allowed value;
- `run:` scripts contain no attacker-controlled expression such as
  `${{ github.event.issue.title }}`, `github.head_ref` or `inputs.*`; pass it
  through `env:` and read `"$VAR"` (see `forbiddenRunExpressions`). Numbers,
  SHAs and `github.event.repository.name` are allowed.

## install-safety.json

Guards the unattended install path in `openaudible-autoupdate.sh`
(the file named by `script`). The check is deliberately simple: line-based, with
comment lines ignored.

- A sha256 comparison of the form `"$actual_sha256" != "$expected_sha256"`
  (`checksumPattern`) must exist, and an `exit` must follow within
  `checksumExitWithin` lines, so a mismatch aborts.
- At least one install command (`dnf|yum|microdnf install|localinstall|reinstall|upgrade`
  or `rpm -i|-U`, `installPattern`) must exist, and every one must come after
  that comparison.
- No line may contain `--nogpgcheck`, `--no-gpgcheck`, `--setopt=...gpgcheck=0`,
  `--nodigest`, `--nosignature`, `--insecure` or `curl -k`
  (`forbiddenPatterns`).
- A missing script is a violation; the policy never passes vacuously.

If the script is rewritten so the comparison is spelled differently, update
`checksumPattern` in the same pull request (Tier 1). The check proves the
guard is present and ordered; it does not prove the guard is correct. The
tests in `tests/unit` and the owner's review do that.

## Threat model

The checker catches accidental omissions: an agent-direction file or workflow
that forgets `--repo Danathar/openaudible-autoupdate`, a missing `permissions:`
block, an unpinned action, an event expression interpolated into a script, a
refactor that moves the install above the checksum or adds `--nogpgcheck`. It
is not a shell or YAML parser and does not defend against deliberately
obfuscated commands (variables built at runtime, `eval`, generated scripts,
aliases, an option assembled in a variable). The hard boundaries are the
repository-scoped `GITHUB_TOKEN`, the required status checks and the owner's
merge. CODEOWNERS only requests the owner's review; the ruleset does not
require it.

## Risk tiers

Not a JSON policy file: the checker also compares the tier table in
[docs/risk-tiers.md](../docs/risk-tiers.md) with
[`risk-config.json`](../risk-config.json) and fails when tier numbers, names,
paths, required commands or review values differ.
`node scripts/check-policies.mjs --classify <path>...` prints the tier of a
path. It cannot see inside a file, so it does not apply the "install path is
Tier 1" rule.
