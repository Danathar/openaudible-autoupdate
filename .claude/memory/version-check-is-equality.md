# The version check is equality, not "newer"

**Date:** 2026-10-09
**Wrong:** assuming the script only installs a newer release, because the
README says "If the manifest's version is newer than what's installed"
(README line 19) and writing tests or docs on that basis.
**Right:** the script only tests `[ "$latest_version" = "$installed_version" ]`
(`openaudible-autoupdate.sh:48`). Any difference, including a manifest that
lists an older version than the installed one, goes on to download and install.
There is no version ordering. Describe it as "different", test it as
"different", and if ordering is wanted, that is a behaviour change to be made
deliberately in its own PR (not slipped into a test or docs change).
**Why it matters:** a test written as "older manifest -> no update" fails
against the real script, and a doc that promises it is wrong.
**Evidence:** `openaudible-autoupdate.sh:38,48-51` at `d769ba1`; README line 19.
