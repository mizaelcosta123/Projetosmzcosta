# jarvis-mobile

[OpenJarvis](https://github.com/open-jarvis/OpenJarvis) adapted to run on an
Android phone: the agent loop lives in **Termux**, the interface is a **web app
you install to the home screen**, and inference comes from a **cloud endpoint
you point it at with an API key**.

It is a plugin, not a fork. OpenJarvis discovers components through decorator
registries, so this package registers into them and leaves upstream untouched —
`git pull` on OpenJarvis never conflicts with anything here.

## What it adds

| Piece | What it gives you |
|---|---|
| **Device tools** | `device_open`, `device_app_launch`, `device_notify`, `device_clipboard`, `device_share`, `device_status` — the phone's apps, share sheet, clipboard and notification shade as agent tools |
| **Provider presets** | OpenRouter, Nous Portal (Hermes), Hugging Face, OpenCode Zen — endpoints pre-filled, you supply only a key. Any other OpenAI-compatible URL still works |
| **Shell** | Nothing to add: OpenJarvis's `shell_exec` runs `subprocess` locally, so inside Termux it already *is* your phone's shell |

## Why this shape

Three things in OpenJarvis made this cheap, and they are worth knowing before
changing anything here:

1. **The server already serves a SPA.** `server/app.py` mounts `static/` with a
   catch-all route, so a built front end dropped in there is served by
   `jarvis serve` — no second web server.
2. **The front end is already decoupled from Tauri.** `frontend/src/lib/api.ts`
   guards every desktop call with `isTauri()` and falls back to plain HTTP. Only
   onboarding (`startBackend`, `stageInferenceSource`) is desktop-only.
3. **Engines are data, not code.** `_OpenAICompatibleEngine` reads
   `<ENGINE_ID>_HOST` / `<ENGINE_ID>_API_KEY` and sets the Bearer header, so a
   provider is a table row.

## Providers

Endpoints verified against each provider's own docs (2026-09):

| Preset | Endpoint | Key from |
|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | <https://openrouter.ai/keys> |
| `nous` | `https://inference-api.nousresearch.com/v1` | <https://portal.nousresearch.com> |
| `huggingface` | `https://router.huggingface.co/v1` | <https://huggingface.co/settings/tokens> (needs the *Providers* permission) |
| `opencode` | `https://opencode.ai/zen/v1` | <https://opencode.ai/auth> |

Each accepts its conventional environment variable as well as the one
OpenJarvis derives — `HF_TOKEN` works for `huggingface`, `OPENCODE_API_KEY` for
`opencode`.

No model list is hardcoded. Catalogs change weekly, so every engine inherits
`list_models()` and asks the provider's own `/v1/models`.

```python
import jarvis_mobile

engine = jarvis_mobile.build_engine("nous")   # key read from NOUS_API_KEY
print(engine.list_models())
```

## Security posture

`device_open`, `device_app_launch` and `device_share` are marked
`requires_confirmation=True`: they act outside Termux, on apps you did not
start, so they route through OpenJarvis's approval flow by default.

Sending SMS, placing calls and reading location are **not** implemented, though
Termux:API exposes all three. An agent that can silently text your contacts is
a different risk class from one that can open a URL — that is a decision to
make deliberately, not to inherit from a default tool list.

## Requirements on the phone

- [Termux](https://f-droid.org/packages/com.termux/) from F-Droid (the Play
  Store build is unmaintained and will not work)
- Termux:API — both the F-Droid app *and* `pkg install termux-api`
- `pkg install termux-am` for `device_app_launch`

Every tool names the missing piece when one of these is absent rather than
failing opaquely.

## Status

Early. The device tools and provider presets are implemented and tested; the
Termux installer and the PWA build are the next pieces.
