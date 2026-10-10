# Never run the real updater on the host

**Date:** 2026-10-09
**Wrong:** running `./openaudible-autoupdate.sh` (or `bash openaudible-autoupdate.sh`,
or through `distrobox enter ... --`) "to see what it does". No incident is
recorded in the history; the hazard is built into the script.
**Right:** the script's last real action is `sudo dnf install -y "$rpm_path"`
(`openaudible-autoupdate.sh:68`), after it has downloaded an rpm from the URL
in OpenAudible's manifest (line 56). On a machine that has the OpenAudible rpm
installed that is a real package upgrade with `sudo`. To exercise the script:

- unit tests: `bats tests/unit` (added by `Danathar/openaudible-autoupdate#54`)
  runs the script with only stub `sudo`, `dnf`, `rpm`, `curl`... on `PATH`,
  built in a temp directory; a hand run needs the same: a stubs directory
  under `tests/` first on `PATH` that holds executable `sudo`, `dnf`, `rpm`,
  which is all the hook accepts;
- end to end: `podman run` / `docker run` a throwaway container
  (`tests/e2e/`, added by `Danathar/openaudible-autoupdate#54`);
- syntax and lint only: `bash -n openaudible-autoupdate.sh`,
  `shellcheck openaudible-autoupdate.sh`.

`distrobox enter` is not a container for this purpose: it enters the owner's
long-lived container, which has the real rpm database and a working `sudo`.
The same applies to `systemctl --user enable|start openaudible-autoupdate.*`,
which schedules the real run (README "Install" does this for users; an agent
does not).
**Why it matters:** it changes software on the owner's machine and cannot be
undone by reverting a commit. The exit code of a dry run tells you nothing
either: with the `log()` bug (see
[log-and-list-under-set-e](log-and-list-under-set-e.md)) the script can die
before it reaches the install.
**Evidence:** `openaudible-autoupdate.sh:23-25` (it requires `sudo` and `dnf`),
`:56`, `:68`; `.claude/hooks/guard-bash.mjs` (header comment lists the exact
exemptions) and `.claude/hooks/tests/guard-bash.test.mjs`; README lines 38-53
(the install steps that enable the timer).
