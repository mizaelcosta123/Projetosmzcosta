"""Install the web interface into the server's static directory.

OpenJarvis serves whatever it finds in ``openjarvis/server/static/`` with an
SPA fallback, so putting the interface there is the whole deployment: one
origin for the page and the API, which means no CORS setup and no second web
server on the phone.

Run it after installing, and again after any upgrade of OpenJarvis — a
reinstall replaces the package directory and takes the interface with it.

    python -m jarvis_mobile.deploy
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

__all__ = [
    "REQUIRED",
    "assets",
    "broken_imports",
    "default_source",
    "deploy",
    "main",
    "static_dir",
]

#: The entry points. Without one of these the source is not the interface, so
#: a missing one is an error rather than a warning.
REQUIRED = ("index.html", "app.js", "styles.css")

#: Not served. Everything *else* in the directory travels, and that direction
#: is the point.
#:
#: This used to be an allowlist of ten filenames. Adding an eleventh module and
#: forgetting the list shipped a page whose first `import` 404s — and a browser
#: that cannot resolve a module aborts the whole graph, so the result is not a
#: degraded page but a black one, with the HTML still rendering. It happened.
SKIPPED = frozenset({"README.md"})

#: `import … from './x.js'` and `export … from './x.js'`, which is how one
#: module in this interface reaches another.
_LOCAL_IMPORT = re.compile(r"""(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"](\./[^'"]+)['"]""")


def assets(source: Path) -> list[str]:
    """Every file in the interface directory that should be served."""
    return sorted(
        entry.name
        for entry in Path(source).iterdir()
        if entry.is_file() and entry.name not in SKIPPED and not entry.name.startswith(".")
    )


def broken_imports(directory: Path) -> list[str]:
    """Local modules a script imports that are not beside it.

    Cheap to check, impossible to notice by looking, and catastrophic in the
    browser — which is the combination that earns a check of its own.
    """
    directory = Path(directory)
    missing = []
    for script in sorted(directory.glob("*.js")):
        text = script.read_text(encoding="utf-8", errors="replace")
        for reference in _LOCAL_IMPORT.findall(text):
            if not (directory / reference.removeprefix("./")).is_file():
                missing.append(f"{script.name} -> {reference}")
    return missing


def static_dir() -> Path:
    """Where OpenJarvis looks for a front end.

    Resolved from the installed package rather than guessed, so it stays
    correct across venvs, editable installs and Termux's own prefix.
    """
    import openjarvis.server

    return Path(openjarvis.server.__file__).parent / "static"


def default_source() -> Path | None:
    """The ``web/`` directory shipped beside this package, if present.

    An installed wheel has no sibling ``web/``; an install from a checkout
    does. Returning ``None`` rather than a bad guess lets the caller ask for
    ``--source`` with a message that means something.
    """
    # src/jarvis_mobile/deploy.py -> src/jarvis_mobile -> src -> <repo>
    candidate = Path(__file__).resolve().parents[2] / "web"
    return candidate if (candidate / "index.html").is_file() else None


def deploy(source: Path, target: Path | None = None) -> list[Path]:
    """Copy the interface into place and return what was written.

    Raises
    ------
    FileNotFoundError
        If the source is not an interface directory, if an entry point is
        missing, or if the copied page would import a module that is not
        there — all three are a blank screen in the browser, and a build that
        stops is better than one that ships that.
    """
    source = Path(source)
    if not (source / "index.html").is_file():
        raise FileNotFoundError(f"{source} does not look like the web interface")

    missing = [name for name in REQUIRED if not (source / name).is_file()]
    if missing:
        raise FileNotFoundError(f"{source} is missing: {', '.join(missing)}")

    destination = Path(target) if target else static_dir()
    destination.mkdir(parents=True, exist_ok=True)

    written = []
    for name in assets(source):
        shutil.copy2(source / name, destination / name)
        written.append(destination / name)

    # After copying, not before: what matters is whether the *served* page can
    # resolve its own modules. Failing the install is right — a build that
    # ships a black screen is worse than one that stops.
    unresolved = broken_imports(destination)
    if unresolved:
        raise FileNotFoundError(
            f"{destination} would serve a page whose imports 404: {', '.join(unresolved)}"
        )
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help="The web/ directory to install (default: the one beside this package).",
    )
    parser.add_argument(
        "--target",
        type=Path,
        default=None,
        help="Where to install it (default: OpenJarvis's own static directory).",
    )
    args = parser.parse_args(argv)

    source = args.source or default_source()
    if source is None:
        print(
            "Could not find the web/ directory. Pass --source <path> pointing at "
            "the jarvis-mobile checkout's web/ folder.",
            file=sys.stderr,
        )
        return 2

    try:
        written = deploy(source, args.target)
    except (FileNotFoundError, OSError) as exc:
        print(f"Deploy failed: {exc}", file=sys.stderr)
        return 1

    print(f"Installed {len(written)} files into {written[0].parent}")
    print("Start it with: jarvis serve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
