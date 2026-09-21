# Project skills

Skills in this directory are picked up automatically by Claude Code when working in
this repository. Each lives in its own folder with a `SKILL.md`; `ORIGIN.md` records
where it came from and how to refresh it.

| Skill | What it does | Source |
|---|---|---|
| [`watch`](watch/) | Gives Claude video input: fetches a video (URL or local path) with `yt-dlp`, extracts frames with `ffmpeg`, pulls a timestamped transcript from captions or Whisper, and hands frames + transcript over so Claude can answer questions about what is actually on screen. Invoke with `/watch <url-or-path> <question>`. | [bradautomates/claude-video](https://github.com/bradautomates/claude-video) @ `83da59f`, MIT — vendored in full |
| [`claude-cookbooks`](claude-cookbooks/) | Index over Anthropic's 96 official Claude API recipes (agents, tool use, RAG, evals, multimodal, caching, cost optimization, Agent SDK, Managed Agents) plus the conventions they follow, so a proven pattern can be located and pulled on demand. | [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) @ `6b671ef`, MIT — indexed, not vendored (upstream is ~211 MB) |

Both are pinned to a specific upstream commit rather than tracking `main`, so they only
change when refreshed deliberately — see each skill's `ORIGIN.md` for the command.
