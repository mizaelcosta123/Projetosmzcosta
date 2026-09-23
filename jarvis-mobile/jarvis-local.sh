#!/usr/bin/env bash
#
# Run the whole thing on this machine. No account, no deploy, no key.
#
#   ./jarvis-local.sh            # serves the interface, points it at Ollama
#   ./jarvis-local.sh 9000       # on a different port
#
# What this is for: the interface is a set of static files, and everything it
# needs from a server it asks for over HTTP. So "local" needs exactly two
# things running -- a file server for the interface, and something that answers
# chat completions. Ollama is the second one. This starts the first and checks
# the second.
#
# The one thing that trips people up is not the ports, it is CORS. A page
# served from http://localhost:8811 is a *different origin* from
# http://localhost:11434, so the browser asks Ollama for permission before it
# will let the page talk to it, and Ollama refuses unless it was started with
# OLLAMA_ORIGINS naming that page. A refused preflight and a closed port look
# identical from JavaScript -- both are a bare TypeError -- which is why this
# script tells the two apart here, where the difference is visible.

set -euo pipefail

PORT="${1:-${JARVIS_PORT:-8811}}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
ORIGIN="http://localhost:${PORT}"
WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web"

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

[ -f "$WEB/index.html" ] || die "Não achei a interface em $WEB."

python=$(command -v python3 || command -v python) || die \
  "Preciso de python3 para servir os arquivos (pkg install python, no Termux)."

# -- is Ollama there at all? --------------------------------------------------
say "Procurando o Ollama em $OLLAMA_URL…"
if ! curl -fsS --max-time 4 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  say ""
  say "  Não respondeu. Em outro terminal:"
  say ""
  say "      OLLAMA_ORIGINS=$ORIGIN ollama serve"
  say ""
  say "  E baixe um modelo, se ainda não tiver:"
  say ""
  say "      ollama pull qwen2.5-coder:1.5b"
  say ""
  say "  Vou servir a interface assim mesmo — ela avisa na tela e deixa você"
  say "  apontar para qualquer outro endereço com chave."
else
  models=$( { curl -fsS --max-time 4 "$OLLAMA_URL/api/tags" || true; } \
    | tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*/  - \1/p')
  if [ -n "$models" ]; then
    say "Respondeu. Modelos instalados:"
    say "$models"
  else
    say "Respondeu, mas sem nenhum modelo. Baixe um:  ollama pull qwen2.5-coder:1.5b"
  fi

  # -- and will it accept the page? -------------------------------------------
  # A preflight, exactly as the browser sends it. This is the check worth
  # having: Ollama answering curl proves nothing about whether it answers a
  # *page*, and that distinction is where an afternoon goes.
  # `|| true` is not decoration: under `set -e` an assignment whose command
  # fails exits the script, and a refused preflight is exactly the case this
  # check exists to report. Without it the script died silently on the one
  # path worth printing.
  allow=$( { curl -sS -X OPTIONS --max-time 4 \
    -H "Origin: $ORIGIN" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' \
    -D - -o /dev/null "$OLLAMA_URL/v1/chat/completions" 2>/dev/null \
    || true; } | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: *//p')

  if [ -z "$allow" ]; then
    say ""
    say "  Ele está no ar, mas recusa esta página: sem Access-Control-Allow-Origin"
    say "  para $ORIGIN. Pare o Ollama e suba de novo assim:"
    say ""
    say "      OLLAMA_ORIGINS=$ORIGIN ollama serve"
    say ""
  else
    say "E aceita esta página (Access-Control-Allow-Origin: $allow)."
  fi
fi

say ""
say "Interface em  $ORIGIN"
say "Pare com Ctrl-C."
say ""

cd "$WEB"
exec "$python" -m http.server "$PORT" --bind 0.0.0.0
