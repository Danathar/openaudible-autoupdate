# Do not end a function or branch in `cmd && cmd` in a `set -e` script

**Date:** 2026-10-09
**Wrong:** the original `log()` ended in
`command -v systemd-cat >/dev/null 2>&1 && echo "$*" | systemd-cat -t "$LOG_TAG"`
(`6caac1b:openaudible-autoupdate.sh:20`). A function returns the status of its
last command. Where `systemd-cat` is not installed (a minimal container, for
example), `command -v` fails, so `log` returned 1, and under `set -euo
pipefail` (line 9) any plain `log "..."` call aborted the script. The same
shape was at line 70 (`command -v notify-send ... && notify-send ...`), which
made the exit status of the "upgraded" branch depend on whether `notify-send`
exists. Reproduced on this host with a stand-alone copy of the function (not
the real script) and a command name that does not exist: `log first` printed
its line, the next `echo` never ran, and the exit status was 1.
**Right:** write it as `if command -v systemd-cat >/dev/null 2>&1; then ... fi`,
which returns 0 when the condition is false. That is what `main` has now:
`log()` at `openaudible-autoupdate.sh:18-23` and the `notify-send` conditional
at lines 72-74, both `if ...; then ...; fi`.
**Why it matters:** in the original, every plain `log "..."` call where
`systemd-cat` was missing aborted the run, including the paths that mean to
exit 0 ("not installed via rpm", "up to date"), which exited 1 instead, with no
message about why. Container and test environments were exactly where that
happened.
**Status:** fixed by `a8758f5` (`Danathar/openaudible-autoupdate#54`), which
also has bats cases for it. Kept as the reason behind the rule; delete it when
nobody is likely to write that shape again.
**Evidence:** `git show 6caac1b:openaudible-autoupdate.sh` lines 9, 18-21, 70;
`a8758f5`'s diff of `openaudible-autoupdate.sh`; `tests/unit/openaudible-autoupdate.bats`.
