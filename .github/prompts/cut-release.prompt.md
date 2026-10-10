---
description: Prepare a tagged release of openaudible-autoupdate
---

Prepare a release for `${input:version}` (tag `v<version>`, semantic
versioning). The repo has no release tooling yet, so keep it manual and
reviewable.

1. Confirm `main` is current and CI is green for its head commit
   (`gh run list --repo Danathar/openaudible-autoupdate --branch main`).
2. Summarise changes since the last tag (`git log <last-tag>..main`, or the
   whole history if there is no tag), grouped by Conventional Commit type.
3. Check that README install and configuration sections match
   `openaudible-autoupdate.sh` and `systemd/`.
4. Draft release notes and show them to the owner. Creating the tag or the
   GitHub release is the owner's call: do not run
   `git tag`/`gh release create --repo Danathar/openaudible-autoupdate` unless
   explicitly asked.
5. Never run the updater to "smoke test" the release; use `bats tests/unit` and
   `tests/e2e/run.sh`.
