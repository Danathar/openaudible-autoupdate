# The manifest's field names belong to OpenAudible

**Date:** 2026-10-09
**Wrong:** treating `version`, `download_dir`, `platforms.<key>.file` and
`platforms.<key>.sha256` as this project's own schema, renaming them in the
script or fixtures, or inventing fields (a `url`, a `checksum`) that the real
manifest does not have.
**Right:** the script reads OpenAudible's published manifest
(`VERSION_URL`, default `https://openaudible.org/downloads/swt_version.json`,
`openaudible-autoupdate.sh:11` at `56c0b3f`). The fields it uses are, with the line that
reads each:

| Field | Line | Notes |
|---|---|---|
| `.version` | 40 | top-level release version string |
| `.download_dir` | 41 | base URL ending in `/`; the script concatenates `${download_dir}${file_name}` (line 58) |
| `.platforms[$k].file` | 42 | file name only, not a URL |
| `.platforms[$k].sha256` | 43 | hex digest |

`$k` is `PLATFORM_KEY`, default `linux_x86_64_rpm` (line 13). The manifest on
2026-10-09 had these keys under `platforms`: `win_x86_64`,
`linux_x86_64_AppImage`, `linux_x86_64`, `linux_x86_64_deb`, `portable`,
`linux_x86_64_rpm`, `linux_aarch64`, `mac`, `win_aarch64`; each entry also
carries `size`, `mb`, `arch`, `version`, `platform` and `md5`, which the script
ignores. Test fixtures should copy this shape. If OpenAudible changes it, the
script changes with it; it is not ours to restructure. A missing key makes `jq`
print the string `null`, which the script checks for `file` only (line 43), not
for `version` or `sha256`.
**Why it matters:** a fixture that invents its own field names passes tests
against code that then fails on the real manifest.
**Evidence:** `openaudible-autoupdate.sh:11,13,40-48,58` at `56c0b3f`; the live manifest at
https://openaudible.org/downloads/swt_version.json (read 2026-10-09, version
5.0.1); README "How it works" step 2.
