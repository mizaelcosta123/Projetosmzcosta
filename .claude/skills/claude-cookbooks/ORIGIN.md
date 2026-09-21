# Origin

This skill indexes [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks)
at commit `6b671ef` (2026-09-18). Upstream is MIT licensed, Copyright (c) 2023 Anthropic.

The repository is ~211 MB (notebook outputs and images), so it is **not** vendored here.
`references/recipes.md` and `references/file-map.md` are generated indexes; individual
recipes are fetched on demand from `raw.githubusercontent.com`.

## Regenerating the indexes

```bash
git clone --depth 1 https://github.com/anthropics/claude-cookbooks /tmp/claude-cookbooks
python3 .claude/skills/claude-cookbooks/scripts/build-cookbook-index.py /tmp/claude-cookbooks .claude/skills/claude-cookbooks/references
```

The script lives at `.claude/skills/claude-cookbooks/scripts/build-cookbook-index.py`.
It rebuilds both reference files from upstream `registry.yaml` and `git ls-files`, and
prints the commit it indexed so the SKILL.md header can be updated to match.
