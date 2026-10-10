# Prompt catalog

Reusable prompt files for Copilot Chat / VS Code (`.prompt.md`); the
content works as a plain prompt in any other tool. All of them assume the rules
in [AGENTS.md](../../AGENTS.md), most importantly: never run
`openaudible-autoupdate.sh` unstubbed, and never weaken the sha256 check. Any `gh` command passes
`--repo Danathar/openaudible-autoupdate`.

| Prompt | Use it when |
|---|---|
| [manifest-format-change.prompt.md](manifest-format-change.prompt.md) | OpenAudible changes `swt_version.json` and the updater breaks or misreads it |
| [add-platform-support.prompt.md](add-platform-support.prompt.md) | Adding another package type or architecture (e.g. a `.deb` / `apt` path) |
| [review-pr.prompt.md](review-pr.prompt.md) | Reviewing a PR against this repo's safety rules |
| [cut-release.prompt.md](cut-release.prompt.md) | Preparing a tagged release |

Add a new prompt as `<verb-noun>.prompt.md` with a `description` in the
frontmatter and a row in the table above.
