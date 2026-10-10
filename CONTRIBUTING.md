# Contributing

Thanks for helping. This project is a single Bash script that upgrades an
installed OpenAudible rpm; see [README.md](README.md) for what it does and
[AGENTS.md](AGENTS.md) for the rules that apply to humans and AI agents alike.
Contributions are licensed GPL-3.0-only, like the rest of the repo.

## Ground rules

- **Do not run `openaudible-autoupdate.sh` for real on your machine to test
  a change.** Its success path runs `sudo dnf install -y`. Use the stubbed
  tests (`tests/unit`) or a throwaway container (`tests/e2e/run.sh`).
- The sha256 verification before install is a security control. Changes that
  weaken it (or add `--nogpgcheck`, `curl -k`) will not be accepted without
  maintainer sign-off.
- Keep the script free of distrobox-specific logic; container support lives
  in the systemd unit (see README).

## Setup

Requirements for development: `bash`, [`shellcheck`](https://www.shellcheck.net/),
[`bats`](https://github.com/bats-core/bats-core), `jq`, and a container runtime
(podman or docker) for the end-to-end tests, and Node 22 for
`node scripts/check-policies.mjs`.

## Before you open a PR

```bash
git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck
bats tests/unit
node scripts/check-policies.mjs
```

If you touched the download, checksum, or install path, also run
`tests/e2e/run.sh`. CI (`.github/workflows/ci.yml`) runs the same checks.
Add or update a bats test for each behaviour change and update the README if
user-visible behaviour or configuration changes.

## Commits and PRs

- Conventional Commits (`fix:`, `feat:`, `docs:`, `test:`, `ci:`, `chore:`).
- One logical change per PR; fill in the PR template with the exact commands
  you ran and what you did not verify.
- If an AI tool helped, say so in the PR description.

## Reporting bugs and requesting features

Use the issue templates. For a bug, include the script output
(`journalctl --user -u openaudible-autoupdate.service`), your distro, and
whether it runs on the host or in a distrobox/toolbox. Report security
problems privately via GitHub's "Report a vulnerability" on the Security tab.
