"""Installing the web interface into the server's static directory."""

from __future__ import annotations

import pytest

from jarvis_mobile import deploy

#: A stand-in interface: the entry points plus a couple of ordinary assets.
SAMPLE = (*deploy.REQUIRED, "particles.js", "icon-192.png", "manifest.webmanifest")


@pytest.fixture
def web(tmp_path):
    """A minimal but complete copy of the interface."""
    source = tmp_path / "web"
    source.mkdir()
    for name in SAMPLE:
        (source / name).write_text(f"contents of {name}", encoding="utf-8")
    return source


def test_it_installs_every_asset(web, tmp_path):
    target = tmp_path / "static"
    written = deploy.deploy(web, target)

    assert len(written) == len(SAMPLE)
    for name in SAMPLE:
        assert (target / name).read_text(encoding="utf-8") == f"contents of {name}"


def test_a_module_added_later_travels_without_being_listed(web, tmp_path):
    """The regression, and the reason the allowlist is gone.

    A new module beside app.js used to need a second edit in this file, and
    forgetting it shipped a page whose first import 404s — which a browser
    answers by rendering nothing at all. The interface directory is now the
    list.
    """
    (web / "diagnose.js").write_text("export const x = 1;\n", encoding="utf-8")
    (web / "app.js").write_text("import { x } from './diagnose.js';\n", encoding="utf-8")

    target = tmp_path / "static"
    deploy.deploy(web, target)
    assert (target / "diagnose.js").is_file()


def test_an_install_that_would_404_is_refused(web, tmp_path):
    """Failing the install beats shipping a black screen."""
    (web / "app.js").write_text("import { x } from './ausente.js';\n", encoding="utf-8")
    target = tmp_path / "static"

    with pytest.raises(FileNotFoundError, match="imports 404"):
        deploy.deploy(web, target)


@pytest.mark.parametrize(
    "line",
    [
        "import { explain } from './diagnose.js';",
        "  import x from './diagnose.js'",
        'export { a } from "./diagnose.js";',
        "import './diagnose.js';\nimport { y } from './diagnose.js';",
    ],
)
def test_broken_imports_recognises_how_modules_are_written(tmp_path, line):
    (tmp_path / "app.js").write_text(line + "\n", encoding="utf-8")
    assert deploy.broken_imports(tmp_path) == ["app.js -> ./diagnose.js"]


def test_a_bare_package_import_is_not_a_local_module(tmp_path):
    """Only './x.js' is ours; a CDN or bare specifier is not our problem."""
    (tmp_path / "app.js").write_text(
        "import x from 'https://cdn.example/x.js';\nimport y from 'lodash';\n",
        encoding="utf-8",
    )
    assert deploy.broken_imports(tmp_path) == []


def test_it_creates_the_target_directory(web, tmp_path):
    target = tmp_path / "does" / "not" / "exist"
    deploy.deploy(web, target)
    assert (target / "index.html").is_file()


def test_it_overwrites_a_previous_install(web, tmp_path):
    """Re-running after an upgrade has to replace stale files, not skip them."""
    target = tmp_path / "static"
    deploy.deploy(web, target)
    (target / "app.js").write_text("stale", encoding="utf-8")

    deploy.deploy(web, target)
    assert (target / "app.js").read_text(encoding="utf-8") == "contents of app.js"


def test_it_leaves_unrelated_files_alone(web, tmp_path):
    """The directory may hold assets from elsewhere; only ours are replaced."""
    target = tmp_path / "static"
    target.mkdir()
    (target / "something-else.txt").write_text("keep me", encoding="utf-8")

    deploy.deploy(web, target)
    assert (target / "something-else.txt").read_text(encoding="utf-8") == "keep me"


def test_it_does_not_ship_notes_or_tests(web, tmp_path):
    """Everything travels except what is named — and a README is named."""
    (web / "README.md").write_text("notes", encoding="utf-8")
    target = tmp_path / "static"

    deploy.deploy(web, target)
    assert not (target / "README.md").exists()


def test_a_wrong_source_is_refused(tmp_path):
    with pytest.raises(FileNotFoundError, match="does not look like"):
        deploy.deploy(tmp_path, tmp_path / "static")


def test_a_missing_entry_point_fails_before_copying_anything(web, tmp_path):
    """Half a page is worse than none: the browser would show a blank screen."""
    (web / "styles.css").unlink()
    target = tmp_path / "static"

    with pytest.raises(FileNotFoundError, match="styles.css"):
        deploy.deploy(web, target)
    assert not target.exists(), "nothing should have been written"


def test_a_missing_ordinary_asset_is_not_fatal(web, tmp_path):
    """Only the entry points are required.

    An interface that dropped an icon should still install; the old allowlist
    could not tell "this file is gone" from "this file was never listed", and
    that conflation is what made adding a module dangerous.
    """
    (web / "icon-192.png").unlink()
    target = tmp_path / "static"

    deploy.deploy(web, target)
    assert (target / "index.html").is_file()
    assert not (target / "icon-192.png").exists()


def test_the_target_defaults_to_openjarvis_own_static_dir():
    path = deploy.static_dir()
    assert path.name == "static"
    assert path.parent.name == "server"


def test_the_cli_reports_a_missing_source_instead_of_guessing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(deploy, "default_source", lambda: None)
    assert deploy.main([]) == 2
    assert "--source" in capsys.readouterr().err


def test_the_cli_installs_and_says_where(web, tmp_path, capsys):
    target = tmp_path / "static"
    assert deploy.main(["--source", str(web), "--target", str(target)]) == 0
    assert str(target) in capsys.readouterr().out
