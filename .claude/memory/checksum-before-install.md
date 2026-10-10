# The checksum comparison stays before the install, and a mismatch aborts

**Date:** 2026-10-09
**Wrong:** moving, weakening or skipping the sha256 check while refactoring or
testing (for example to make a stubbed download "work", or installing first
and verifying after).
**Right:** keep the order the script has: download to `$WORKDIR`
(`openaudible-autoupdate.sh:57-61`), compute `sha256sum` of that file
(line 63), compare with `.platforms[$k].sha256` from the manifest and exit 1 on
mismatch (lines 64-67), and only then `sudo dnf install -y` (line 70). Tests
that need a passing install must serve a file whose real sha256 matches the
manifest they provide, not bypass the comparison. A test for the mismatch path
must assert that `dnf` was not called.
**Why it matters:** the downloaded rpm is installed as root. The checksum,
fetched from OpenAudible's own manifest, is the only check the script makes on
what it installs; the order is what makes it a gate. [INFERENCE] Because the
manifest and the file come from the same publisher, this guards against a
corrupted or tampered download, not against a compromised publisher.
**Evidence:** `openaudible-autoupdate.sh:57-70` at `56c0b3f`; README "How it works" step 3
("downloads the rpm, verifies its checksum, and runs `sudo dnf install -y`").
