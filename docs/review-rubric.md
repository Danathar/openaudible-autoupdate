# PR review rubric

How changes to this repository (`Danathar/openaudible-autoupdate`) get
reviewed. Written for the owner, for agents reviewing, and for agents checking
their own work before opening a PR. The product is one Bash script,
[`openaudible-autoupdate.sh`](../openaudible-autoupdate.sh), that runs
unattended from a systemd user timer and ends in `sudo dnf install -y` of a
file downloaded from the network. That shapes everything below: a mistake here
does not show up as a failed page, it shows up as a wrong package installed on
someone's machine, or as an updater that silently stops updating.

Review in this order. The first section that fails is the one to fix. Where
this page and [AGENTS.md](../AGENTS.md) disagree, AGENTS.md wins.

## Severity levels

Review findings use the four levels the Codex connector
(`chatgpt-codex-connector[bot]`) can attach to its comments as `P0`-`P3`
badges, so a human, an agent and Codex all describe a finding the same way.
Codex findings are advisory: verify each against the code before acting, reply
with the reasoning, and resolve the thread either way.

| level | meaning | merge? |
|---|---|---|
| P0 | Installs something that was not verified: the checksum comparison is bypassed, skipped on an error path, or compares the wrong file or the wrong value. Also: arbitrary command execution from manifest content, a secret exposed, a licence violation | Never. Fix first, even if CI is green |
| P1 | Wrong behaviour a user will hit: the script exits or aborts where it should continue (or the reverse), installs the wrong platform's package, mis-compares versions so it loops or never updates, a systemd unit that never runs or runs the wrong command | Not until fixed, or the owner accepts the risk in the PR thread |
| P2 | Real but narrow: an unquoted variable that only breaks on unusual names, a missing test for an error path, a failure that is reported with the wrong message, a temp file not cleaned up on one path | Fix in the PR, or reply with why it does not apply and resolve the thread |
| P3 | Style, naming, comment wording, documentation phrasing | Optional; do not block on it |

## 1. Scope and rules

- [ ] **One concern per PR**, sized to the problem. A bug fix does not reformat
      the script.
- [ ] **Risk tier.** Find the tier of the paths touched in
      [risk-tiers.md](risk-tiers.md) and review at that depth: the more
      sensitive the path, the more of sections 2-6 apply and the less a green
      CI is worth by itself. Agent limits per path are in
      [agent-boundaries.md](agent-boundaries.md).
- [ ] **Licence.** `LICENSE` (GPL-3.0) is untouched and the README licence
      statement stays; copied-in code carries a GPL-3.0-compatible licence.
- [ ] **Nobody ran the script for real.** The test plan in the PR body uses
      stubbed commands or a throwaway container, never the host: the script
      ends in `sudo dnf install -y`.

## 2. The checksum-before-install invariant

The central property of the script: **nothing reaches `dnf install` unless its
SHA-256 matched the value the manifest advertised.** Today that is the
sequence download, `sha256sum`, compare, install, with `exit 1` on a mismatch.
Any diff that touches it needs all of these:

- [ ] The compare runs on the file that is later installed (same path variable
      in `sha256sum` and in `dnf install`), after the download finished and
      before the install.
- [ ] A mismatch, an empty or `null` expected value, a failed `sha256sum`, or
      a failed download each end in a non-zero exit **before** `dnf`. Check the
      empty case in particular: `jq -r` prints the string `null` for a missing
      key, and an empty expected value must never compare equal to anything.
- [ ] Nothing between verification and install can swap the file: it stays in
      the `mktemp -d` work directory, not in a shared or predictable path.
- [ ] No new install path (a second `dnf`/`rpm -i` call, a fallback mirror,
      `--nogpgcheck`, `--skip-broken`, `rpm --nosignature`) bypasses the
      comparison.
- [ ] The tests cover the mismatch path and assert `dnf` was never called.

## 3. Shell behaviour under `set -euo pipefail`

The script runs with `set -euo pipefail`, which makes some innocent-looking
lines fatal and others silently ignored. Review each changed line for which
one it is.

- [ ] **`cmd && other` as the last command of a function.** The function's
      status is the status of the `&&` list, so when `cmd` fails the function
      returns non-zero and `set -e` ends the script. The `log()` helper at
      line 20 of `openaudible-autoupdate.sh` at `d769ba1`
      (`command -v systemd-cat ... && echo ... | systemd-cat`) had exactly this
      shape: in an environment without `systemd-cat` the first `log` call
      aborts the script with status 1. The same `&&` form inside an `if`
      branch (the `notify-send` line) does not abort. This was checked with
      `bash -c 'set -e; f(){ echo hi; false && echo y; }; f; echo after'`,
      which never prints `after`. Prefer `if ...; then ...; fi` or end the
      function with `|| true` when the failure is meant to be harmless.
- [ ] **Command substitutions** (`x=$(jq ...)`) fail the script when the inner
      command fails. Where a failure is expected (`rpm -q` when the package is
      not installed) it must sit in an `if !` or `||` so the script chooses
      the outcome.
- [ ] **Pipelines.** With `pipefail`, a failure anywhere in `a | b` fails the
      line. `sha256sum file | awk ...` is fine; a pipeline that is *supposed*
      to tolerate a failing first stage is not.
- [ ] **`-u`.** Optional variables use `${VAR:-}`; defaults use the existing
      `: "${VAR:=default}"` form.
- [ ] **Exit codes mean something.** `exit 0` means "nothing to do" (up to
      date, or OpenAudible not installed via rpm), `exit 1` means a failure
      the timer should surface. A new early exit picks the right one.
- [ ] **Cleanup.** The `trap ... EXIT` removes the work directory; new temp
      files live inside it.

## 4. Quoting and manifest input

The version manifest at `VERSION_URL` is network input and is **untrusted**:
anything in it is data, never code.

- [ ] Every expansion is quoted (`"$rpm_path"`, `"${download_dir}${file_name}"`),
      and options are not built from manifest strings.
- [ ] Manifest values are read only through `jq` (with `--arg` for keys taken
      from variables) and are never passed to `eval`, `bash -c`, `sh`, or
      unquoted `$(...)`.
- [ ] A `file_name` from the manifest is used as a name inside the work
      directory; reject or neutralise `/` and `..` before joining it to a path.
- [ ] The download URL is built from the manifest and fetched with
      `curl -fsSL`: `-f` so an HTTP error is a failure, not an HTML page that
      is then hashed. A change that drops `-f` or switches to plain `http://`
      is P1 or worse.
- [ ] Version comparison handles what the manifest can really contain:
      missing `.version` (jq prints `null`), a version equal to the installed
      one, and a version older than the installed one.
- [ ] No secrets, tokens or hostnames in logs, fixtures or docs.

## 5. Host, container and systemd behaviour

The script is meant to run where OpenAudible's rpm is installed: a plain
Fedora/RHEL host or inside a distrobox/toolbox container (see the README and
the comments in [`systemd/`](../systemd)).

- [ ] **Where it runs.** The script has no distrobox-specific logic. Container
      awareness belongs in the `ExecStart=` wrapper
      (`distrobox enter <name> -- %h/bin/openaudible-autoupdate.sh`), not in
      the script.
- [ ] **Dependencies.** A new external command is added to the dependency check
      loop (`curl jq rpm sudo dnf sha256sum` today) or guarded with
      `command -v`, and is available in a minimal container. Optional helpers
      (`systemd-cat`, `notify-send`) are guarded and their absence is not an
      error.
- [ ] **`sudo` without a terminal.** Under a systemd user unit there is no
      TTY: the behaviour when `sudo` needs a password must stay a clean
      failure with a log line, not a hang.
- [ ] **Unit files.** `systemd/openaudible-autoupdate.service` stays
      `Type=oneshot` with a working `ExecStart=` (`%h` expands to the user's
      home); `systemd/openaudible-autoupdate.timer` keeps `[Install]
      WantedBy=timers.target`, `OnCalendar`, and `Persistent=true`. Check
      with `systemd-analyze verify` where available.
- [ ] README install and `systemctl --user` instructions match the unit file
      names and paths in the diff.

## 6. Tests

- [ ] New behaviour has a test that fails without the change, and a bug fix
      includes the test that would have caught it. Unit tests are bats files
      under `tests/` that put stub commands (`curl`, `rpm`, `dnf`, `sudo`,
      ...) first on `PATH`; container end-to-end tests are under
      `tests/e2e/`. The jobs that run them are in
      [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- [ ] Tests check observable outcomes (exit status, log lines, whether the
      stubbed `dnf` was called and with which file), not that a function ran.
- [ ] The error paths are exercised: missing dependency, curl failure,
      checksum mismatch, `dnf` failure, platform key missing, package not
      installed, already up to date.
- [ ] `shellcheck` is clean without new blanket `# shellcheck disable`.
- [ ] CI is green **and the branch is current with `main`**. A green run on a
      stale branch says little about the merge result.
- [ ] Nothing in the tests or the PR body runs the real script against the
      host's `dnf`.

## 7. Housekeeping

- [ ] Commits follow Conventional Commits; the PR title does too. No
      `Signed-off-by` trailers unless the owner asked.
- [ ] Docs changed with behaviour: the README, and `AGENTS.md`/`CLAUDE.md` if
      a rule or command changed.
- [ ] Workflows: top-level `permissions:` read-only (write scopes only on the
      job that needs them), third-party actions (anything outside `actions/*`)
      pinned to a full commit SHA with a `# vX` comment, event-controlled
      strings passed through `env:` rather than interpolated into `run:`, no
      `pull_request_target`. A workflow that calls `gh` sets
      `GH_REPO: ${{ github.repository }}` and passes `--repo "$GH_REPO"`.
- [ ] No generated or local files committed (`.env`, downloaded rpms, scratch
      directories).

## Reviewing agent PRs (Hive and others)

- The agent's own report is a claim, not evidence. Check the commands it says
  it ran against the CI result and the diff.
- Hive PRs end with a signature line (`— hive: agent=<name>`); the author is
  `app/danathar-atomic-hive`. They get the same rubric as a human PR, and
  their outcomes are the "Hive app" row of [metrics.md](metrics.md).
- A PR that widens what an agent may do (workflows, `.claude/settings.json`,
  hooks, rulesets) is reviewed at the highest tier whatever its size.
- Do not push to a contributor's branch to fix it; comment instead.
