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
| **Device tools** | `device_open`, `device_app_launch`, `device_notify`, `device_clipboard`, `device_share`, `device_status`, `device_shell`, `device_read` — the phone's apps, share sheet, clipboard, notification shade, shell and files as agent tools |
| **Live voice** | Press the bars in the composer, or say his name, and it listens: your speech is transcribed and sent, and he stops mid-sentence when you cut in. A noise only ducks him; words are what interrupt |
| **Device bridge** | The same tools from a backend that is *not* on the phone: a one-file runner in Termux dials out over a WebSocket and the agent's calls travel down it. Works behind NAT, opens no port, and the phone decides what it will run |
| **Provider presets** | OpenRouter, Nous Portal (Hermes), Hugging Face, OpenCode Zen — endpoints pre-filled, you supply only a key. Any other OpenAI-compatible URL still works |
| **Shell** | Inside Termux, OpenJarvis's own `shell_exec` already *is* your phone's shell. From anywhere else, `device_shell` is — over the bridge |
| **Holograms** | 3D wireframe solids made by voice ("um cubo vermelho à direita") or by the model through the `conjure` tool. They sit in your room under WebXR and, everywhere else, on the screen, where a finger moves, pinches, twists and deletes them |
| **Memory** | What you ask and the names you teach, recalled by attention for the next question. Visible and deletable in Configurações → Memória, and exported to / imported from an **Obsidian** note |
| **Place and weather** | When — and only when — a question is about where you are or the sky, and location was already granted: a position rounded to ~1 km, and the forecast from Open-Meteo (no key) |
| **Installed app** | A service worker that opens the app with no signal (network first, so a deploy is never hidden) and notifies you when a reply lands while you are in another app |

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

## Running it on your own machine

The interface is static files. Everything it needs from a server it asks for
over HTTP, so "local" means two things running: a file server for the
interface, and something that answers chat completions.

```sh
./jarvis-local.sh          # serves the interface, checks Ollama, says what is wrong
```

Then open `http://localhost:8811`. With Ollama up, the first load finds it,
points at it and saves that — no settings, no key, no account. One request.

What actually trips people up is not the ports, it is CORS. A page on
`http://localhost:8811` is a **different origin** from `http://localhost:11434`,
so the browser asks Ollama for permission first and Ollama refuses unless it
was started knowing about that page:

```sh
OLLAMA_ORIGINS=http://localhost:8811 ollama serve
ollama pull qwen2.5-coder:1.5b
```

From JavaScript a refused preflight and a closed port are the same bare
`TypeError`, which is why `jarvis-local.sh` sends the preflight itself and
reports the two separately, and why the interface prints the exact
`OLLAMA_ORIGINS` line when it cannot get through.

Nothing about this is Ollama-specific: **any** OpenAI-compatible endpoint works
the same way — LM Studio, vLLM, llama.cpp, a hosted API with a key. Paste the
address and the key in Configurações, press *Testar e carregar modelos*, and
the model list fills from the endpoint itself.

### What a local endpoint cannot do

Reach your phone. `device_open`, `device_shell` and the rest are registered in
the agent, which lives in the Jarvis backend — a bare model endpoint has no
agent behind it, however good the model is. The app finds this out for itself
(one request to `/v1/device`), remembers the answer, and says so in the
Aparelho panel instead of asking you to redeploy something that was never
there.

That answer is also what stops the waste: no agent means no event WebSocket
and no `/v1/info`, so pointing at Ollama costs **zero** requests on load and
two for a message.

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

engine = jarvis_mobile.build_engine("nous")  # key read from NOUS_API_KEY
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

| Done | |
|---|---|
| Device tools, the bridge, provider presets | tested in Python |
| Termux installer (`install-termux.sh`) and Render deploy (`render.yaml`) | |
| Interface: face and orb, expressions, gaze, live voice with barge-in | |
| Providers with a model catalogue, and routing by what each model got right | |
| Holograms: by voice, by the model's `conjure` tool, on the screen with gestures, in the room with WebXR | |
| Attention-based memory, visible and deletable, round-tripping through Obsidian | |
| Location and weather, only when a question needs them | |
| Installable PWA that opens offline and notifies | |

Not done, on purpose or by limit:

- **Tracking your hand through the camera.** A phone in AR uses the rear
  camera and WebXR exposes no hands on a phone, so the gesture that works is
  touch — and that is what exists. Front-camera tracking (MediaPipe) outside
  AR would mean a model of several megabytes fetched from another domain: a
  decision to make, not one to inherit.
- **Syncing a vault folder by itself.** Chrome on Android has no directory
  picker; what works on the phone is the `.md` file out and back. An adapter
  that reads the vault directly from Termux is the natural next step — `Memory`
  already accepts one.
- **SMS and calls** — see *Security posture* above.
