#!/usr/bin/env bats

# The docs cite code in the updater as `openaudible-autoupdate.sh:<line>`.
# The script keeps growing, so a bare line number soon points at the wrong
# code. A line reference must name the commit it was read at somewhere in the
# same paragraph (`at <sha>`, or `<sha>:openaudible-autoupdate.sh:<line>`);
# otherwise name the code itself (a variable, a check, a log message).

REPO_ROOT="$BATS_TEST_DIRNAME/../.."

# Prints every Markdown paragraph under $1 that has an unpinned line reference.
# Plain POSIX awk: the ubuntu job runs mawk, which has no {n,m} intervals.
unpinned_line_refs() {
  find "$1" -name .git -prune -o -name node_modules -prune -o -name '*.md' -type f \
    -exec awk -v RS= '
      /openaudible-autoupdate\.sh:[0-9]/ &&
      !/`[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]+`/ &&
      !/[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]:openaudible-autoupdate\.sh/ {
        print FILENAME ": " $0
      }' {} +
}

@test "no doc cites a line of openaudible-autoupdate.sh without naming its commit" {
  run unpinned_line_refs "$REPO_ROOT"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "the line-reference check flags a bare reference and accepts pinned ones" {
  local dir="$BATS_TEST_TMPDIR/docs"
  mkdir -p "$dir"
  cat >"$dir/bare.md" <<'EOF'
Installs as root
(`openaudible-autoupdate.sh:70`).
EOF
  cat >"$dir/at-sha.md" <<'EOF'
Installs as root (`openaudible-autoupdate.sh:70`
at `56c0b3f`).
EOF
  cat >"$dir/sha-prefix.md" <<'EOF'
See `6caac1b:openaudible-autoupdate.sh:20`.
EOF
  cat >"$dir/other-para.md" <<'EOF'
Pinned elsewhere at `56c0b3f`.

But not here (`openaudible-autoupdate.sh:9`).
EOF

  run unpinned_line_refs "$dir"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bare.md: "* ]]
  [[ "$output" == *"other-para.md: But not here"* ]]
  [[ "$output" != *"at-sha.md"* ]]
  [[ "$output" != *"sha-prefix.md"* ]]
}
