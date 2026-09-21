"""Installing the web interface into the server's static directory."""

from __future__ import annotations

import pytest

from jarvis_mobile import deploy


@pytest.fixture
def web(tmp_path):
    """A minimal but complete copy of the interface."""
    source = tmp_path / "web"
    source.mkdir()
    for name in deploy.ASSETS:
        (source / name).write_text(f"contents of {name}", encoding="utf-8")
    return source


def test_it_installs_every_asset(web, tmp_path):
    target = tmp_path / "static"
    written = deploy.deploy(web, target)

    assert len(written) == len(deploy.ASSETS)
    for name in deploy.ASSETS:
        assert (target / name).read_text(encoding="utf-8") == f"contents of {name}"


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
    """Only the listed assets travel — a README must not end up served."""
    (web / "README.md").write_text("notes", encoding="utf-8")
    target = tmp_path / "static"

    deploy.deploy(web, target)
    assert not (target / "README.md").exists()


def test_a_wrong_source_is_refused(tmp_path):
    with pytest.raises(FileNotFoundError, match="does not look like"):
        deploy.deploy(tmp_path, tmp_path / "static")


def test_a_missing_asset_fails_before_copying_anything(web, tmp_path):
    """Half a page is worse than none: the browser would show a blank screen."""
    (web / "particles.js").unlink()
    target = tmp_path / "static"

    with pytest.raises(FileNotFoundError, match="particles.js"):
        deploy.deploy(web, target)
    assert not target.exists(), "nothing should have been written"


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
