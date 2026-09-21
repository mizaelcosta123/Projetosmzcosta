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
import shutil
import sys
from pathlib import Path

__all__ = ["default_source", "deploy", "main", "static_dir"]

#: Files the interface needs. Anything else in the source directory is skipped,
#: so notes and tests never end up served to the browser.
ASSETS = (
    "index.html",
    "styles.css",
    "app.js",
    "particles.js",
    "face.js",
    "orb.js",
    "voice.js",
    "manifest.webmanifest",
    "icon-192.png",
    "icon-512.png",
)


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
        If the source is not an interface directory, or a required asset is
        missing — better than serving a half-copied page that fails in the
        browser with a blank screen.
    """
    source = Path(source)
    if not (source / "index.html").is_file():
        raise FileNotFoundError(f"{source} does not look like the web interface")

    missing = [name for name in ASSETS if not (source / name).is_file()]
    if missing:
        raise FileNotFoundError(f"{source} is missing: {', '.join(missing)}")

    destination = Path(target) if target else static_dir()
    destination.mkdir(parents=True, exist_ok=True)

    written = []
    for name in ASSETS:
        shutil.copy2(source / name, destination / name)
        written.append(destination / name)
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
