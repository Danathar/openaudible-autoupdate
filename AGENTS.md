# AGENTS.md

Authoritative instructions for every AI coding agent working in this repo
(Claude Code, GitHub Copilot, Cursor, Codex, others). Tool-specific files
([CLAUDE.md](CLAUDE.md), [.github/copilot-instructions.md](.github/copilot-instructions.md),
[.cursor/rules/openaudible-autoupdate.mdc](.cursor/rules/openaudible-autoupdate.mdc))
only point here; if they disagree with this file, this file wins.

## What this repo is

One Bash script, `openaudible-autoupdate.sh`, plus two systemd **user** units.
OpenAudible ships standalone installers with no package repository, so the
script keeps an existing **rpm** install current:

1. `rpm -q --qf '%{VERSION}' "$PKG_NAME"` gives the installed version
   (not installed via rpm -> log and exit 0).
2. `curl` fetches the manifest at `VERSION_URL`
   (`https://openaudible.org/downloads/swt_version.json`); `jq` reads
   `.version`, `.download_dir`, `.platforms[$PLATFORM_KEY].file` and
   `.platforms[$PLATFORM_KEY].sha256`.
3. If the manifest version differs from the installed one (string
   inequality, not a semver comparison), it downloads
   `${download_dir}${file}` into a `mktemp -d` directory, compares
   `sha256sum` against the manifest, and only then runs
   `sudo dnf install -y <rpm>`.
4. Logs to stdout and `systemd-cat`; `notify-send` after a successful upgrade.

Licence: GPL-3.0-only (see `LICENSE`). Default branch: `main`.

## Files

| Path | Purpose |
|---|---|
| `openaudible-autoupdate.sh` | The updater |
| `systemd/openaudible-autoupdate.service` | `Type=oneshot`, `ExecStart=%h/bin/openaudible-autoupdate.sh` |
| `systemd/openaudible-autoupdate.timer` | `OnCalendar=daily`, `RandomizedDelaySec=30m`, `Persistent=true` |
| `README.md` | User docs, install, distrobox/Aurora usage |
| `tests/unit/` | bats unit tests (`openaudible-autoupdate.bats`, stubs in `helpers.bash`) |
| `tests/e2e/` | Container end-to-end test: `run.sh` (host side), `in-container.sh` |
| `.shellcheckrc`, `.coverage-thresholds.json` | Lint config; coverage floor |
| `scripts/coverage-gate.mjs` | Coverage gate used by `.github/workflows/coverage-gate.yml` |
| `.github/workflows/ci.yml` | CI. Six required checks (ruleset 24826574, see `docs/branch-protection.md`): `Lint (shellcheck)`, `Unit tests (ubuntu bash)`, `Unit tests (fedora container)`, `E2E (fedora container)` (these four from `ci.yml`), `Coverage gate` (`coverage-gate.yml`) and `policy-check` (`policy-check.yml`) |

## Hard rules

- **NEVER run `openaudible-autoupdate.sh` for real on a host or dev machine.**
  The success path runs `sudo dnf install -y` and changes the system. Run it
  only with stubbed commands on a private `PATH` (`tests/unit` stubs `rpm`,
  `curl`, `sudo`, `dnf`, `notify-send` and `systemd-cat`; `sha256sum`, `jq`
  and `awk` stay real) or inside a throwaway container
  (`bash tests/e2e/run.sh`). Never run `tests/e2e/in-container.sh` directly:
  it installs as root and is meant only to run inside the container. Never use `/tmp` for scratch work in this owner's
  environment; use `/var/tmp/<name>-*`.
- **The checksum check must stay between download and install.** Never
  reorder, skip, soften, or make non-fatal the `sha256sum` comparison. Never
  add `--nogpgcheck`, `--no-gpgchecks`, `-k`/`--insecure` on `curl`, or
  any other verification bypass without explicit owner approval. Keep
  `set -euo pipefail`.
- Do not widen what the script is allowed to install: it installs only the
  file named by the manifest for `PLATFORM_KEY`, from `download_dir`.
- Never commit secrets or tokens. Do not `git commit -s`; use Conventional
  Commits (`fix:`, `feat:`, `docs:`, `test:`, `ci:`, `chore:`).
- Every `gh` command passes `--repo Danathar/openaudible-autoupdate`.
- Do not edit repo settings, labels or rulesets; do not merge your own PRs.
- Disclose any change beyond what was asked in the PR description.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `VERSION_URL` | `https://openaudible.org/downloads/swt_version.json` | Manifest URL |
| `PKG_NAME` | `OpenAudible` | rpm package to check/upgrade |
| `PLATFORM_KEY` | `linux_x86_64_rpm` | Key under `.platforms` |

Required commands (checked up front, exit 1 if missing): `curl jq rpm sudo
dnf sha256sum awk`. Optional: `systemd-cat`, `notify-send`.

## Deployment context

- Installed by copying the script to `~/bin/` and the two units to
  `~/.config/systemd/user/`; used with `systemctl --user` and
  `journalctl --user -u openaudible-autoupdate.service`.
- The author runs [Aurora](https://getaurora.dev/) (bootc, partly immutable),
  so OpenAudible usually lives in a distrobox/toolbox container. The timer
  still runs on the host and the unit's `ExecStart` is overridden (drop-in)
  to `distrobox enter <container> -- %h/bin/openaudible-autoupdate.sh`. The
  script itself has no distrobox logic; keep it that way.
- Notes in README must stay true to the script (e.g. do not claim semver
  comparison).

## Testing

```bash
git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck   # lint, config in .shellcheckrc
bats tests/unit                  # unit tests, stub commands only
bash tests/e2e/run.sh            # needs podman or docker; see below
```

`tests/e2e/run.sh` builds dummy OpenAudible rpms in a throwaway Fedora
container, serves a manifest locally and runs the script there, including a
real `dnf install` inside that container only. Run it when you touch the
download, checksum or install path. Line coverage is gated by
`.github/workflows/coverage-gate.yml` (floor in `.coverage-thresholds.json`;
the README Testing section has the kcov command). CI runs the same checks: see the jobs in
`.github/workflows/ci.yml`. Add or update a bats test for every behaviour
change.

## Agent tooling in this repo

| Path | What it is |
|---|---|
| `CLAUDE.md` | Claude Code entry point (imports this file) |
| `.github/copilot-instructions.md` | Copilot instructions |
| `.cursor/rules/openaudible-autoupdate.mdc` | Cursor rule (always applied) |
| `.github/prompts/` | Reusable prompt files (see its README) |
| `.claude/skills/` | Claude skills: `run-checks`, `test-against-fake-manifest`, `handle-manifest-change` |
| `.claude/settings.json` | Claude hooks/permissions; a Bash guard hook blocks dangerous commands |
| `.claude/memory/` | Durable cross-session knowledge |
| `.claude/session-summary.md` | Session state (see below) |
| `policies/` | Policy-as-code checked in CI |
| `docs/risk-tiers.md` | Change classification by risk |
| `docs/security/SECURITY-AI.md` | AI security policy |

`policies/` is enforced by `node scripts/check-policies.mjs` (CI workflow
`.github/workflows/policy-check.yml`); it requires the literal
`--repo Danathar/openaudible-autoupdate` in every agent-direction file and
guards the install path against verification bypasses. Run it after editing
agent docs, and run `node --test scripts/tests/*.test.mjs` if you change
scripts.

## Session continuity

Session state lives in `.claude/session-summary.md`. At the start of work
read it, `.claude/memory/` and recent `git log`. Only the session that lands
work on `main` rewrites the summary (see the end-of-session rule at the top
of that file); a session that opens a PR to be merged later puts its notes
(what was done, what is in flight, next steps) in the PR body instead, so
concurrent PRs do not conflict. Record durable lessons in `.claude/memory/`,
not in chat. Any agent (not only Claude) should treat these as the shared
handoff point.

## Pull requests

Use the PR template. List the exact checks you ran with results, say what
you did not verify, and note that the PR was prepared by an AI agent. Changes
to the update path (download, checksum, `dnf install`, `sudo`) are
high-risk: see `docs/risk-tiers.md` and run the e2e tests.
