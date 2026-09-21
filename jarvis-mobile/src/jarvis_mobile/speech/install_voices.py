"""Put the Brazilian MBROLA voice data where MBROLA looks for it.

The voices come from `brasiltts <https://github.com/felipefacundes/brasiltts>`_,
which ships them as Arch Linux packages. Only the ``mbrola`` binary in that set
is architecture-specific — the voice databases are plain data and work
anywhere, which is what makes them usable on a phone at all.

So this extracts the data and ignores the binaries: on Termux you install
``espeak-ng`` from the package manager and build MBROLA for aarch64 once, then
these databases drop straight in.

    python -m jarvis_mobile.speech.install_voices --source ~/brasiltts
"""

from __future__ import annotations

import argparse
import os
import sys
import tarfile
from pathlib import Path

from jarvis_mobile.speech.brasil_tts import VOICES

__all__ = ["install_from_packages", "main", "target_dir"]

#: Inside the Arch packages, the voice data lives here.
_ARCHIVE_PREFIX = "usr/share/mbrola/"


def target_dir() -> Path:
    """Where MBROLA reads voices on this machine.

    Termux's prefix wins when present: that is the install this targets, and
    writing to /usr/share there would fail or be ignored.
    """
    prefix = os.environ.get("PREFIX", "")
    if "com.termux" in prefix:
        return Path(prefix) / "share/mbrola"
    return Path("/usr/share/mbrola")


def _safe_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    """Voice-data members only, with traversal and link entries rejected.

    These archives come from a third party. A member named ``../../etc/passwd``
    or a symlink pointing outside the tree would otherwise write wherever it
    liked — extraction is the one place that has to assume nothing.
    """
    members = []
    for member in archive.getmembers():
        if not member.name.startswith(_ARCHIVE_PREFIX):
            continue
        if not (member.isfile() or member.isdir()):
            continue  # no symlinks, devices or hard links
        relative = Path(member.name)
        if relative.is_absolute() or ".." in relative.parts:
            continue
        members.append(member)
    return members


def install_from_packages(source: Path, destination: Path | None = None) -> list[str]:
    """Extract every voice package found in `source`. Returns voice names.

    Raises
    ------
    FileNotFoundError
        When the directory holds no voice packages — far more likely to mean
        the wrong path than a broken checkout.
    """
    source = Path(source)
    packages = sorted(source.glob("mbrola-voices-br*.pkg.tar.*"))
    if not packages:
        raise FileNotFoundError(
            f"no MBROLA voice packages in {source}. Clone brasiltts first:\n"
            "  git clone https://github.com/felipefacundes/brasiltts"
        )

    target = Path(destination) if destination else target_dir()
    target.mkdir(parents=True, exist_ok=True)

    for package in packages:
        with tarfile.open(package) as archive:
            members = _safe_members(archive)
            for member in members:
                # Strip the package's own prefix so br1/br1 lands at <target>/br1/br1.
                member.name = member.name[len(_ARCHIVE_PREFIX) :]
                if not member.name:
                    continue
                archive.extract(member, target, filter="data")

    return [
        name
        for name, spec in VOICES.items()
        if (target / spec["mbrola"] / spec["mbrola"]).is_file()
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--source",
        type=Path,
        default=Path.home() / "brasiltts",
        help="A brasiltts checkout (default: ~/brasiltts).",
    )
    parser.add_argument(
        "--target", type=Path, default=None, help="Where to install (default: MBROLA's dir)."
    )
    args = parser.parse_args(argv)

    try:
        installed = install_from_packages(args.source, args.target)
    except (FileNotFoundError, OSError, tarfile.TarError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not installed:
        print("Packages extracted, but no voice database landed.", file=sys.stderr)
        return 1

    where = args.target or target_dir()
    print(f"Installed into {where}:")
    for name in installed:
        spec = VOICES[name]
        print(f"  {name:<12} {spec['label']:<12} {spec['note']}")
    print(
        "\nCheck it works:  python -c 'import jarvis_mobile; "
        "from openjarvis.core.registry import TTSRegistry; "
        'print(TTSRegistry.get("brasiltts")().health())\''
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
