# Correction memory

One file per correction: a mistake an agent made, or nearly made, in this
repository, the rule that prevents it, and the evidence. The conversation that
produced a mistake is gone by the next session; these files are what is left.

**Host rule.** `openaudible-autoupdate.sh` runs `sudo dnf install -y` on the
machine it runs on. Never run it on a real host, and never run `sudo`, `dnf
install`, `rpm -i/-U/-e` or `systemctl --user enable/start
openaudible-autoupdate*` as an agent. Test it with stub commands first on
`PATH` (`tests/`) or inside `podman run`/`docker run`. `.claude/hooks/guard-bash.mjs`
enforces this. Pull requests, issues and comments go to
`Danathar/openaudible-autoupdate` (`--repo Danathar/openaudible-autoupdate`).

## What goes here

- Something an agent got wrong, or came within one step of getting wrong, that
  is easy to repeat and hard to see from the code alone.
- Not here: standing rules that apply to all work (those are in
  [AGENTS.md](../../AGENTS.md)), what is in flight right now (that is
  [../session-summary.md](../session-summary.md)), and patterns in how the
  work goes (those are [../../docs/reflections/](../../docs/reflections/README.md)).
  A correction that hardens into a standing rule is promoted to AGENTS.md; the
  entry stays as the reason behind the rule.

## Naming and format

`<kebab-case-topic>.md`, one correction per file, in this shape:

```markdown
# <short title>

**Date:** YYYY-MM-DD (when it was recorded)
**Wrong:** what was done or assumed
**Right:** what is true / what to do
**Why it matters:** the consequence of repeating it
**Evidence:** commit, PR or file:line that shows it
```

Evidence must be something a reader can open. A claim that cannot be checked
against a commit, a PR or a file does not get an entry. Line numbers name the
commit they were read at (`git show <commit>:openaudible-autoupdate.sh`); the
script changed in `a8758f5` and `56c0b3f`, so re-check before relying on them.

## When to add and retire

- Add an entry in the same PR that fixes the mistake, or at the end of the
  session in which it was caught. Check the index below first and extend an
  existing entry rather than adding a near-duplicate.
- Re-verify an entry before relying on it: line numbers drift. If it is no
  longer true (for example `log()` has been fixed and merged), delete or
  rewrite the file in the PR that makes it untrue. A stale correction is worse
  than none.
- Add the new file to the index below.

## Index

| Entry | One line |
|---|---|
| [log-and-list-under-set-e](log-and-list-under-set-e.md) | Fixed in `a8758f5`: `log()` used to end in `cmd && cmd`, which exits 1 under `set -e` when `systemd-cat` is missing; do not reintroduce it |
| [never-run-updater-on-host](never-run-updater-on-host.md) | The script installs an rpm with `sudo dnf install -y`; test with stubs or a container |
| [checksum-before-install](checksum-before-install.md) | The sha256 comparison must stay before the install, and a mismatch must abort |
| [manifest-field-names-are-openaudibles](manifest-field-names-are-openaudibles.md) | `version`, `download_dir`, `platforms.<key>.file`/`.sha256` belong to OpenAudible's manifest; do not rename or invent fields |
| [version-check-is-equality](version-check-is-equality.md) | The script compares versions for equality, not "newer"; any difference triggers an install |
