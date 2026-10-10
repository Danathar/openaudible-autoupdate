# log() ends in `cmd && cmd`; under `set -e` it exits 1 when systemd-cat is missing

**Date:** 2026-10-09
**Wrong:** assuming `log()` is a harmless wrapper around `echo`. Its last
statement is `command -v systemd-cat >/dev/null 2>&1 && echo "$*" | systemd-cat -t "$LOG_TAG"`
(`openaudible-autoupdate.sh:20` at `d769ba1`). A function returns the status of
its last command. Where `systemd-cat` is not installed (a minimal container,
for example), `command -v` fails, so `log` returns 1, and under `set -euo
pipefail` (`openaudible-autoupdate.sh:9`) any plain `log "..."` call then
aborts the script. The same shape is at line 70
(`command -v notify-send ... && notify-send ...`), where it makes the exit
status of the "upgraded" branch depend on whether `notify-send` exists.
**Right:** write the condition as `if command -v systemd-cat >/dev/null 2>&1; then ... fi`,
which returns 0 when the condition is false. Do not write `a && b` as the last
command of a function or branch in a `set -e` script. Reproduced on this
host with a stand-alone copy of the function (not the real script) and a
command name that does not exist: `log first` printed its line, the next
`echo` never ran, and the exit status was 1.
**Why it matters:** every plain `log "..."` call (lines 24, 28, 34, 44, 49, 53,
57, 63, 67, 69, 72) aborts the script where `systemd-cat` is missing. Worse,
the paths that mean to exit 0 (lines 28-29 "not installed via rpm", lines
49-50 "up to date") exit 1 instead, because `log` fails before the `exit 0`. A
container or test environment without `systemd-cat` reports every run as a
failure, with no message about why.
**Status:** fixed by the foundation PR, `Danathar/openaudible-autoupdate#54`
(`log()` and the `notify-send` line both become `if ...; then ...; fi`); it was
open, not merged, when this was written. If `main`'s `log()` still ends in `&&`,
the fix has not landed. Delete this entry or rewrite it as history once it has.
**Evidence:** `openaudible-autoupdate.sh:9,18-21,70` at `d769ba1` (unchanged
since the first commit `6caac1b`); PR #54's diff of `openaudible-autoupdate.sh`.
