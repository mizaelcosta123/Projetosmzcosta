#!/data/data/com.termux/files/usr/bin/bash
#
# Install Jarvis on Android, inside Termux.
#
#   curl -fsSL <raw-url>/install-termux.sh | bash
#
# What it does, and why it does it this way:
#
#   OpenJarvis's own installer assumes a desktop — it fetches Ollama and a
#   local model, neither of which belongs on a phone. This one installs the
#   same framework with a dependency set chosen so almost nothing has to be
#   compiled on the device, points inference at a cloud endpoint you reach with
#   an API key, and serves the particle interface from the same origin as the
#   API so there is no CORS setup and no second web server.
#
# The dependency set is the whole trick. A full install pulls 18 packages with
# compiled extensions — pyarrow, pandas and numpy among them, none of which has
# an Android wheel. Dropping `datasets` (used only by two eval files) removes
# twelve of them, and skipping the `openai` SDK removes `jiter`, the Rust
# package that breaks most Termux installs. What remains needs pydantic-core,
# which Termux can build.

set -euo pipefail

REPO_URL="${JARVIS_REPO_URL:-https://github.com/mizaelcosta123/Projetosmzcosta}"
OPENJARVIS_URL="${OPENJARVIS_URL:-https://github.com/open-jarvis/OpenJarvis}"
ROOT="${JARVIS_HOME:-$HOME/jarvis}"
VENV="$ROOT/venv"
PY="$VENV/bin/python"

# Everything OpenJarvis actually needs for: the CLI, the API server, the agent
# loop, and an OpenAI-compatible cloud engine. Verified by installing exactly
# this set and driving a request end to end.
CORE_DEPS=(click croniter httpx rich tomlkit websockets pyyaml)
SERVER_DEPS=(fastapi uvicorn python-multipart pydantic)

say()  { printf '\n\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m !\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31m ✗\033[0m %s\n' "$*" >&2; exit 1; }

# -- environment ------------------------------------------------------------

[ -n "${PREFIX:-}" ] && [ -d "$PREFIX" ] || die \
  "This installer is for Termux on Android. On a computer, use OpenJarvis's own installer."

say "Updating Termux packages"
pkg update -y >/dev/null 2>&1 || warn "pkg update failed; continuing with what is installed"

# python-pip is separate in current Termux; git fetches the sources; rust,
# clang, binutils and make are what pydantic-core needs to build.
say "Installing system packages (this is the slow part)"
pkg install -y python python-pip git rust clang binutils make libexpat openssl \
  || die "pkg install failed. Run it by hand to see which package is unavailable."

# Optional, and worth having: without it the device tools cannot reach Android.
if ! pkg install -y termux-api termux-am >/dev/null 2>&1; then
  warn "termux-api/termux-am not installed — device tools will be unavailable."
  warn "Install the Termux:API app from F-Droid, then: pkg install termux-api termux-am"
fi

# -- sources ----------------------------------------------------------------

mkdir -p "$ROOT"

fetch() { # fetch <url> <dir> <label>
  if [ -d "$2/.git" ]; then
    say "Updating $3"
    git -C "$2" pull --ff-only || warn "Could not update $3; using the existing checkout"
  else
    say "Fetching $3"
    git clone --depth 1 "$1" "$2" || die "Could not clone $3 from $1"
  fi
}

fetch "$OPENJARVIS_URL" "$ROOT/openjarvis" "OpenJarvis"
fetch "$REPO_URL" "$ROOT/jarvis-mobile-repo" "jarvis-mobile"
MOBILE="$ROOT/jarvis-mobile-repo/jarvis-mobile"
[ -d "$MOBILE" ] || die "jarvis-mobile not found at $MOBILE"

# -- python environment -----------------------------------------------------

say "Creating the Python environment"
[ -d "$VENV" ] || python -m venv "$VENV"
"$PY" -m pip install --upgrade pip wheel >/dev/null

say "Installing dependencies"
"$PY" -m pip install --quiet "${CORE_DEPS[@]}" || die "Could not install the core dependencies"

# pydantic-core is the one package that must be compiled here. Say so before
# the terminal goes quiet for ten minutes, so it does not look like a hang.
say "Installing the server (pydantic builds from source — allow ~10 minutes)"
if ! "$PY" -m pip install --quiet "${SERVER_DEPS[@]}"; then
  die "pydantic failed to build. Usually a missing toolchain — check:
  pkg install rust clang binutils make
Low-memory devices can also be killed mid-build; close other apps and retry."
fi

# --no-deps is deliberate: the declared set pulls datasets and the openai SDK,
# which is exactly what we spent the effort avoiding.
say "Installing OpenJarvis"
"$PY" -m pip install --quiet --no-deps "$ROOT/openjarvis" || die "OpenJarvis install failed"

say "Installing jarvis-mobile"
"$PY" -m pip install --quiet "$MOBILE" || die "jarvis-mobile install failed"

# -- configuration ----------------------------------------------------------

CONFIG_DIR="$HOME/.openjarvis"
CONFIG="$CONFIG_DIR/config.toml"
mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG" ]; then
  say "Keeping your existing config at $CONFIG"
else
  say "Writing a starter config"
  cat > "$CONFIG" <<'TOML'
# Jarvis on Android. Pick a provider, set its key, and you are running.
#
#   nous         NOUS_API_KEY          https://portal.nousresearch.com
#   openrouter   OPENROUTER_API_KEY    https://openrouter.ai/keys
#   huggingface  HF_TOKEN              https://huggingface.co/settings/tokens
#   opencode     OPENCODE_API_KEY      https://opencode.ai/auth
#
# Put the key in ~/.jarvis-env (the launcher sources it), then set the engine
# here to match. Ask the assistant to list its models if you are unsure what to
# put in default_model.

[intelligence]
default_model = ""          # empty: the interface asks the server what it serves
preferred_engine = "nous"

[engine]
default = "nous"

[agent]
default_agent = "orchestrator"
max_turns = 8
# Device tools need the Termux:API app. Drop any you would rather not grant.
tools = "think,calculator,shell_exec,file_read,web_search,device_open,device_notify,device_clipboard,device_share,device_status,device_app_launch,set_display_mode"
context_from_memory = false

[tools.storage]
default_backend = "sqlite"
db_path = "~/.openjarvis/memory.db"

[learning]
enabled = false

[telemetry]
enabled = false
gpu_metrics = false

[traces]
enabled = true
db_path = "~/.openjarvis/traces.db"

[server]
# Loopback only: the interface runs in this phone's browser, so nothing needs
# to reach it from the network. Binding wider also requires an API key.
host = "127.0.0.1"
port = 8000
TOML
fi

ENV_FILE="$HOME/.jarvis-env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'ENVEOF'
# Your API key goes here. Uncomment the line for the provider you chose and
# paste the key. This file is read by the `jarvis-start` launcher.
#
# export NOUS_API_KEY="..."
# export OPENROUTER_API_KEY="..."
# export HF_TOKEN="..."
# export OPENCODE_API_KEY="..."
ENVEOF
  chmod 600 "$ENV_FILE"
fi

# -- interface --------------------------------------------------------------

say "Installing the interface"
"$PY" -m jarvis_mobile.deploy --source "$MOBILE/web" || die "Could not install the web interface"

# -- launcher ---------------------------------------------------------------

BIN="$PREFIX/bin/jarvis-start"
cat > "$BIN" <<LAUNCHER
#!/data/data/com.termux/files/usr/bin/bash
# Start Jarvis and keep the phone from sleeping the process.
set -e
[ -f "\$HOME/.jarvis-env" ] && . "\$HOME/.jarvis-env"
command -v termux-wake-lock >/dev/null && termux-wake-lock || true
trap 'command -v termux-wake-unlock >/dev/null && termux-wake-unlock || true' EXIT
echo "Jarvis is at http://127.0.0.1:8000 — open it in your browser."
exec "$VENV/bin/jarvis" serve "\$@"
LAUNCHER
chmod +x "$BIN"

# -- check ------------------------------------------------------------------

say "Checking the install"
"$PY" - <<'CHECK'
import sys

from openjarvis.core.registry import EngineRegistry, ToolRegistry

providers = [k for k in ("nous", "openrouter", "huggingface", "opencode") if EngineRegistry.contains(k)]
devices = sorted(k for k in ToolRegistry.keys() if k.startswith("device_"))
print(f"  providers : {', '.join(providers) or 'NONE — the plugin did not load'}")
print(f"  device    : {len(devices)} tools")
if not providers:
    sys.exit(1)
CHECK

cat <<DONE

  Installed.

  1. Put your API key in:  ~/.jarvis-env
  2. Start it with:        jarvis-start
  3. Open in the browser:  http://127.0.0.1:8000
     Add it to your home screen and it opens like an app.

  Ask him to show his face and he will.

DONE
