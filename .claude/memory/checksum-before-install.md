# The checksum comparison stays before the install, and a mismatch aborts

**Date:** 2026-10-09
**Wrong:** moving, weakening or skipping the sha256 check while refactoring or
testing (for example to make a stubbed download "work", or installing first
and verifying after).
**Right:** keep the order the script has: download to `$WORKDIR`
(`openaudible-autoupdate.sh:55-59`), compute `sha256sum` of that file
(line 61), compare with `.platforms[$k].sha256` from the manifest and exit 1 on
mismatch (lines 62-65), and only then `sudo dnf install -y` (line 68). Tests
that need a passing install must serve a file whose real sha256 matches the
manifest they provide, not bypass the comparison. A test for the mismatch path
must assert that `dnf` was not called.
**Why it matters:** the downloaded rpm is installed as root. The checksum,
fetched from OpenAudible's own manifest, is the only check the script makes on
what it installs; the order is what makes it a gate. [INFERENCE] Because the
manifest and the file come from the same publisher, this guards against a
corrupted or tampered download, not against a compromised publisher.
**Evidence:** `openaudible-autoupdate.sh:55-68` at `d769ba1`; README line 20
("downloads the rpm, verifies its checksum, and runs `sudo dnf install -y`").
