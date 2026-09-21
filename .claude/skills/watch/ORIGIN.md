# Origin

This skill is a vendored copy of the `watch` skill from
[bradautomates/claude-video](https://github.com/bradautomates/claude-video),
taken from `skills/watch/` at commit `83da59f` (2026-06-30). Licensed MIT —
see `LICENSE` in this directory.

Nothing was modified. To refresh it:

```bash
git clone --depth 1 https://github.com/bradautomates/claude-video /tmp/claude-video
rsync -a --delete /tmp/claude-video/skills/watch/ .claude/skills/watch/ \
  --exclude ORIGIN.md --exclude LICENSE
cp /tmp/claude-video/LICENSE .claude/skills/watch/LICENSE
```

## Runtime requirements

The skill shells out to `yt-dlp` and `ffmpeg`; `scripts/setup.py` installs them on
first run (auto via `brew` on macOS, printed commands on Linux/Windows). Captions
cover most public videos for free. A Whisper API key (Groq `whisper-large-v3` or
OpenAI `whisper-1`) is only needed for videos without captions, and goes in
`~/.config/watch/.env` — never in this repository.

Upstream also ships the same skill as a Claude Code plugin
(`/plugin marketplace add bradautomates/claude-video`), which auto-updates. This
vendored copy is pinned instead, so it stays put until refreshed deliberately.
