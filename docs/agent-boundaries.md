# Agent boundaries

What an AI agent may change on its own in this repository, and what needs the
owner (Danathar). It maps the tiers in [docs/risk-tiers.md](risk-tiers.md) to
the owners in [`.github/CODEOWNERS`](../.github/CODEOWNERS), and complements
`AGENTS.md` and the [AI security policy](security/SECURITY-AI.md).

Agents open pull requests against `Danathar/openaudible-autoupdate` only
(`--repo Danathar/openaudible-autoupdate` on every `gh` write command).

## By tier

| Tier | Agent may | Agent may not |
| ---- | --------- | ------------- |
| 1 critical | Propose a change in a pull request when the owner asked for it, and run the required commands. | Merge it, change it as part of unrelated work, or edit files that bound agents (`AGENTS.md`, `policies/`, `risk-config.json`, `.github/CODEOWNERS`, `.github/workflows/`) at all unless the owner told it to. |
| 2 high | Open a pull request with the required commands run and reported. | Merge it. The owner reads the diff. |
| 3 medium | Open a pull request; the jobs in `.github/workflows/ci.yml` are the gate. | Skip or loosen a failing check. |
| 4 low | Open a pull request; CI is the gate. | Use a docs-only change to hide a change to a command users run. |

Tier is by what the change can break, and the highest tier any touched path
matches applies. **The install path of `openaudible-autoupdate.sh` is Tier 1
even though the file matches Tier 2**: the manifest fields read with `jq`, the
download path built from `file_name`, the sha256 comparison and its `exit 1`,
and the `sudo dnf install -y` line. `node scripts/check-policies.mjs
--classify <path>...` prints the tier of a path but cannot see inside a file.

## Who owns what

`.github/CODEOWNERS` assigns `@Danathar` to everything (`*`) and repeats the
Tier 1 and Tier 2 paths explicitly, so an owner review request is created for
them and the path list is easy to find. When branch protection requires code
owner review, Tier 1 and Tier 2 paths cannot merge without the owner. Until it
does, the table above is the rule and CODEOWNERS is the review request. Keep
the CODEOWNERS paths in step with the tier table in
[risk-tiers.md](risk-tiers.md).

## Always off limits

These need the owner's explicit instruction in the conversation, whatever the
tier:

- Running `openaudible-autoupdate.sh` for real, or the systemd units that run
  it: it executes `sudo dnf install`. Use stubs or a throwaway container.
- Weakening checksum verification, adding `--nogpgcheck` or any option that
  skips package checks ([SECURITY-AI.md](security/SECURITY-AI.md), section
  1.1).
- Secrets, `.env` files, `~/.ssh`, tokens, and the user's OpenAudible library
  ([SECURITY-AI.md](security/SECURITY-AI.md), section 2).
- Editing `LICENSE`.
- Repository settings, rulesets, labels, secrets, branch protection.
- Merging, approving, or force-pushing.
- Posting anywhere other than `Danathar/openaudible-autoupdate`.

## Files that bound agents

Changing these relaxes the agent boundary itself, so a green CI run is not
enough and the owner reads the diff:

- `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/`,
  `.github/prompts/`, `.claude/skills/`, `.claude/memory/`
- `.claude/settings.json` and `.claude/hooks/` (the permission table and the
  Bash guard)
- `policies/`, `scripts/check-policies.mjs`, `risk-config.json`,
  `.github/CODEOWNERS`, `.github/workflows/`
- `docs/security/`, `docs/risk-tiers.md`, this file (Tier 4 by path; the owner's
  review is requested through CODEOWNERS)

`policies/repo-target.json` lists the direction files that must carry
`--repo Danathar/openaudible-autoupdate`. Add a new one there when you add a
new kind of agent instruction file.
