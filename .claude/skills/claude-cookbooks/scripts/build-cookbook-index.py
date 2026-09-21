#!/usr/bin/env python3
"""Rebuild the claude-cookbooks reference indexes from an upstream checkout.

Usage:
    python3 build-cookbook-index.py <path-to-claude-cookbooks-clone> <references-dir>

Writes recipes.md (registry entries grouped by category) and file-map.md (every
notebook/doc/module in the repo, by directory), and prints the indexed commit.
"""

import io
import os
import subprocess
import sys

import yaml

SKIP_PREFIXES = (".github/", ".claude/", "tests/", "scripts/")
KEEP_SUFFIXES = (".ipynb", ".md", ".py")
REPO_URL = "https://github.com/anthropics/claude-cookbooks"
RAW_URL = "https://raw.githubusercontent.com/anthropics/claude-cookbooks/main"


def short_sha(repo):
    return subprocess.check_output(
        ["git", "-C", repo, "rev-parse", "--short", "HEAD"], text=True
    ).strip()


def build_recipes(recipes, sha):
    by_category = {}
    for recipe in recipes:
        category = (recipe.get("categories") or ["Uncategorized"])[0]
        by_category.setdefault(category, []).append(recipe)

    out = io.StringIO()
    out.write("# Claude Cookbooks — recipe index\n\n")
    out.write(f"Generated from `registry.yaml` of [anthropics/claude-cookbooks]({REPO_URL}) @ `{sha}`.\n\n")
    out.write("Raw file URL pattern:\n\n")
    out.write(f"```\n{RAW_URL}/<path>\n```\n\n")
    out.write(f"{len(recipes)} recipes across {len(by_category)} primary categories.\n\n")

    for category in sorted(by_category):
        out.write(f"## {category}\n\n")
        for recipe in sorted(by_category[category], key=lambda r: r["title"].lower()):
            description = " ".join((recipe.get("description") or "").split())
            categories = ", ".join(recipe.get("categories") or [])
            out.write(f"### {recipe['title']}\n\n")
            out.write(f"- **Path:** `{recipe['path']}`\n")
            if categories:
                out.write(f"- **Categories:** {categories}\n")
            if description:
                out.write(f"- {description}\n")
            out.write("\n")
    return out.getvalue()


def build_file_map(repo, registry_paths, sha):
    tracked = subprocess.check_output(["git", "-C", repo, "ls-files"], text=True).splitlines()
    files = [
        f
        for f in tracked
        if f.endswith(KEEP_SUFFIXES)
        and not f.startswith(SKIP_PREFIXES)
        and "/.ipynb_checkpoints/" not in f
    ]

    out = io.StringIO()
    out.write("# Claude Cookbooks — full file map\n\n")
    out.write(
        f"Every notebook, doc and helper module in [anthropics/claude-cookbooks]({REPO_URL}) "
        f"@ `{sha}`, including files that are not listed in `registry.yaml`.\n\n"
    )
    out.write("`*` marks a file that appears in the recipe registry (see `recipes.md` for its description).\n\n")

    current = None
    for path in sorted(files):
        directory = os.path.dirname(path) or "."
        if directory != current:
            out.write(f"\n## `{directory}/`\n\n")
            current = directory
        mark = " *" if path in registry_paths else ""
        out.write(f"- `{os.path.basename(path)}`{mark}\n")
    return out.getvalue(), len(files)


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    repo, references = sys.argv[1], sys.argv[2]
    sha = short_sha(repo)
    recipes = yaml.safe_load(open(os.path.join(repo, "registry.yaml")))
    registry_paths = {r["path"] for r in recipes}

    os.makedirs(references, exist_ok=True)
    with open(os.path.join(references, "recipes.md"), "w") as fh:
        fh.write(build_recipes(recipes, sha))
    file_map, count = build_file_map(repo, registry_paths, sha)
    with open(os.path.join(references, "file-map.md"), "w") as fh:
        fh.write(file_map)

    print(f"indexed {repo} @ {sha}: {len(recipes)} recipes, {count} files")
    print("Update the commit referenced in SKILL.md and ORIGIN.md to match.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
