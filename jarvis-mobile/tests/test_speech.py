"""Speech: the local voices, the cloud voice, and the clip the browser plays."""

from __future__ import annotations

import subprocess
import tarfile

import pytest

from jarvis_mobile.speech import brasil_tts, install_voices, openrouter_tts
from jarvis_mobile.tools import speak

# -- local voices -----------------------------------------------------------


def test_the_three_brasiltts_voices_are_named():
    assert set(brasil_tts.VOICES) == {"angelo", "maricota", "nordestino"}
    for spec in brasil_tts.VOICES.values():
        assert spec["mbrola"].startswith("br")
        assert spec["label"] and spec["note"]


def test_an_unknown_voice_lists_the_real_ones(monkeypatch):
    monkeypatch.setattr(brasil_tts, "_installed_voices", lambda: ["angelo"])
    with pytest.raises(RuntimeError, match="maricota"):
        brasil_tts.BrasilTTSBackend().synthesize("oi", voice_id="darth-vader")


def test_only_wav_is_offered(monkeypatch):
    """MBROLA emits PCM; converting would add ffmpeg to buy nothing."""
    with pytest.raises(RuntimeError, match="WAV"):
        brasil_tts.BrasilTTSBackend().synthesize("oi", output_format="mp3")


def test_empty_text_is_silence_not_an_error():
    result = brasil_tts.BrasilTTSBackend().synthesize("   ")
    assert result.audio == b""


def test_a_missing_binary_says_how_to_install_it(monkeypatch):
    monkeypatch.setattr(brasil_tts.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="pkg install espeak-ng"):
        brasil_tts.BrasilTTSBackend().synthesize("oi")


def test_missing_voice_data_points_at_the_installer(monkeypatch):
    monkeypatch.setattr(brasil_tts.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(brasil_tts, "_installed_voices", list)
    with pytest.raises(RuntimeError, match="install_voices"):
        brasil_tts.BrasilTTSBackend().synthesize("oi", voice_id="angelo")


def test_health_needs_binaries_and_a_voice(monkeypatch):
    backend = brasil_tts.BrasilTTSBackend()
    monkeypatch.setattr(brasil_tts.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(brasil_tts, "_installed_voices", list)
    assert backend.health() is False
    monkeypatch.setattr(brasil_tts, "_installed_voices", lambda: ["angelo"])
    assert backend.health() is True


def test_a_timeout_is_reported_as_such(monkeypatch):
    monkeypatch.setattr(brasil_tts.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(brasil_tts, "_installed_voices", lambda: ["angelo"])

    def hang(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="espeak-ng", timeout=60)

    monkeypatch.setattr(brasil_tts.subprocess, "run", hang)
    with pytest.raises(RuntimeError, match="timed out"):
        brasil_tts.BrasilTTSBackend().synthesize("oi", voice_id="angelo")


def test_the_same_sentence_gets_the_same_filename():
    """Content-addressed, so a daily greeting is synthesized once."""
    first = brasil_tts.audio_filename("bom dia", "angelo")
    assert first == brasil_tts.audio_filename("bom dia", "angelo")
    assert first != brasil_tts.audio_filename("bom dia", "maricota")
    assert first != brasil_tts.audio_filename("boa noite", "angelo")


# -- cloud voice ------------------------------------------------------------


def test_the_cloud_backend_needs_a_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    backend = openrouter_tts.OpenRouterTTSBackend()
    assert backend.health() is False
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        backend.synthesize("hello")


def test_the_cloud_backend_surfaces_the_providers_error(monkeypatch):
    import httpx

    request = httpx.Request("POST", "https://openrouter.ai/api/v1/audio/speech")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: httpx.Response(402, text="Insufficient credits", request=request),
    )
    backend = openrouter_tts.OpenRouterTTSBackend(api_key="k")
    with pytest.raises(RuntimeError, match="Insufficient credits"):
        backend.synthesize("hello")


def test_the_cloud_backend_trusts_the_response_content_type(monkeypatch):
    import httpx

    request = httpx.Request("POST", "https://openrouter.ai/api/v1/audio/speech")
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *a, **k: httpx.Response(
            200,
            content=b"RIFFfake",
            headers={"content-type": "audio/wav", "X-Generation-Id": "gen-1"},
            request=request,
        ),
    )
    result = openrouter_tts.OpenRouterTTSBackend(api_key="k").synthesize("hello")
    assert result.format == "wav"
    assert result.metadata["generation_id"] == "gen-1"


# -- the clip the interface plays -------------------------------------------


def test_speak_needs_something_to_say():
    result = speak.SpeakTool().execute(text="  ")
    assert not result.success


def test_speak_reports_when_no_backend_is_ready(monkeypatch):
    monkeypatch.setattr(
        speak, "_pick_backend", lambda *a: (_ for _ in ()).throw(RuntimeError("nothing ready"))
    )
    result = speak.SpeakTool().execute(text="oi")
    assert not result.success
    assert "nothing ready" in result.content


def test_the_cloud_backend_is_preferred_when_healthy():
    """Local is the fallback that works offline, not the better voice."""
    assert speak._PREFERRED.index("openrouter_tts") < speak._PREFERRED.index("brasiltts")


def test_pruning_keeps_the_newest_clips(tmp_path):
    import os
    import time

    for index in range(12):
        clip = tmp_path / f"clip{index}.wav"
        clip.write_bytes(b"x")
        os.utime(clip, (time.time() + index, time.time() + index))

    removed = speak.prune_old_clips(tmp_path, keep=5)
    assert removed == 7
    assert len(list(tmp_path.glob("*.wav"))) == 5
    assert (tmp_path / "clip11.wav").is_file(), "the newest must survive"


def test_pruning_a_missing_directory_is_not_an_error(tmp_path):
    assert speak.prune_old_clips(tmp_path / "gone") == 0


# -- installing the voice data ----------------------------------------------


def test_a_wrong_source_says_where_to_clone_from(tmp_path):
    with pytest.raises(FileNotFoundError, match="brasiltts"):
        install_voices.install_from_packages(tmp_path, tmp_path / "out")


def test_extraction_rejects_paths_that_escape_the_target(tmp_path):
    """These archives are third-party; extraction assumes nothing about them."""
    package = tmp_path / "mbrola-voices-br9-1-any.pkg.tar"
    payload = tmp_path / "payload"
    payload.write_bytes(b"data")

    with tarfile.open(package, "w") as archive:
        archive.add(payload, arcname="usr/share/mbrola/br9/br9")
        archive.add(payload, arcname="usr/share/mbrola/../../../escaped")

    with tarfile.open(package) as archive:
        kept = {member.name for member in install_voices._safe_members(archive)}
    assert kept == {"usr/share/mbrola/br9/br9"}


def test_extraction_rejects_links(tmp_path):
    package = tmp_path / "mbrola-voices-br9-1-any.pkg.tar"
    with tarfile.open(package, "w") as archive:
        link = tarfile.TarInfo("usr/share/mbrola/br9/link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        archive.addfile(link)

    with tarfile.open(package) as archive:
        assert install_voices._safe_members(archive) == []


def test_the_target_follows_termux_when_present(monkeypatch):
    monkeypatch.setenv("PREFIX", "/data/data/com.termux/files/usr")
    assert "com.termux" in str(install_voices.target_dir())
    monkeypatch.setenv("PREFIX", "/usr/local")
    assert install_voices.target_dir() == install_voices.Path("/usr/share/mbrola")
