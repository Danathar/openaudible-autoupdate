## Summary

<!-- What changed and why. Closes #N -->

## Checks run

<!-- Paste the exact commands and observed results. -->

- [ ] `git ls-files -z '*.sh' '*.bash' '*.bats' | xargs -0 shellcheck`
- [ ] `bats tests/unit`
- [ ] `bash tests/e2e/run.sh` (required if the download, checksum, or `dnf install` path changed)
- [ ] `node scripts/check-policies.mjs` (if agent docs, policies or workflows changed)
- [ ] Added/updated a bats test for each behaviour change
- [ ] README updated if behaviour or configuration changed

## Safety

- [ ] sha256 verification still happens before `dnf install` and is fatal on mismatch
- [ ] No `--nogpgcheck`, `curl -k`, or other verification bypass added
- [ ] I did not run `openaudible-autoupdate.sh` unstubbed on a real host

## Not verified

<!-- Anything you could not test (e.g. a real OpenAudible release). -->

## AI assistance

- [ ] This PR was prepared with AI assistance (name the tool), or
- [ ] No AI assistance was used
