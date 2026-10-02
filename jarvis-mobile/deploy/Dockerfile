# Jarvis backend — the server, the interface, and a Brazilian voice.
#
# Deliberately not OpenJarvis's own image: that one builds a React SPA with npm
# and a Rust extension, neither of which this stack uses. The dependency set
# here is the one measured for Android — no datasets, no openai SDK — which
# also makes it a small, fast image anywhere else.
#
#   docker build -f deploy/Dockerfile -t jarvis .
#   docker run -p 8000:8000 -e OPENROUTER_API_KEY=... jarvis

FROM python:3.12-slim-bookworm

# openssh-client is the other road to a phone: JARVIS_DEVICE_SSH points at a
# Termux sshd, for the case where the server and the phone are on the same
# network. From Render they are not, so there it is dead weight — a few
# hundred kilobytes against a branch that would otherwise fail with a
# confusing 'ssh não está instalado' the first time anyone tried it.
#
# espeak-ng turns text into phonemes and MBROLA turns phonemes into a voice, so
# the container speaks Portuguese with no network and no model. git is only
# needed to fetch OpenJarvis and the voice data during the build.
#
# MBROLA sits in Debian's `contrib` area — the synthesizer itself is free but
# its upstream voice databases are not, which keeps it out of `main`. The slim
# image enables `main` alone, so without the extra source below apt answers
# "Unable to locate package mbrola" and the build dies right here. A separate
# .list file rather than an edit to the image's own sources: that file is
# one-line format in bookworm and deb822 in trixie, and this works on both.
#
# It still gets its own apt-get line, and failing it is tolerated: local speech
# is a bonus on a cloud backend, where OpenRouter TTS is reachable and `speak`
# already prefers it. espeak-ng is not optional the same way — it is in `main`,
# and without it there is no phonemizer at all.
#
# No comments inside the RUN: a comment line between two continuations is
# stripped by the parser, which is easy to get wrong and silently drops a step.
RUN set -eux; \
    echo 'deb http://deb.debian.org/debian bookworm contrib' \
        > /etc/apt/sources.list.d/contrib.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        git ca-certificates espeak-ng \
        openssh-client; \
    apt-get install -y --no-install-recommends mbrola \
        || echo 'WARNING: mbrola unavailable; local Brazilian voice disabled'; \
    rm -rf /var/lib/apt/lists/*

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

ARG OPENJARVIS_REF=main
ARG BRASILTTS_REF=master

WORKDIR /opt

# Exactly the set proven to run the CLI, the server, the agent loop and an
# OpenAI-compatible engine. Installed before the application so a code change
# does not re-resolve them.
#
# `requests` is not optional despite httpx covering the engine: importing
# openjarvis.server.app reaches research_router -> research_loop ->
# hybrid_search -> connectors.embeddings, which imports it at module level. Drop
# it and `jarvis serve` dies with ModuleNotFoundError before it ever binds.
#
# `ddgs` is what makes the enabled `web_search` tool work with no API key: the
# You.com path answers 403 unkeyed and the fallback is DuckDuckGo, which needs
# this package or the tool returns "No search engine available". It costs ~29 MB
# (it pulls primp and lxml, both compiled) and is the reason it is in the image
# and NOT in install-termux.sh -- primp is Rust, which is the exact trap the
# phone dependency set was measured to avoid.
RUN pip install \
        click croniter httpx rich tomlkit websockets pyyaml \
        fastapi uvicorn python-multipart pydantic requests ddgs

# --no-deps is load-bearing: OpenJarvis's declared dependencies pull `datasets`
# (pyarrow, pandas, numpy) and the `openai` SDK, which is what the minimal set
# exists to avoid.
RUN git clone --depth 1 --branch "${OPENJARVIS_REF}" \
        https://github.com/open-jarvis/OpenJarvis openjarvis \
    && pip install --no-deps ./openjarvis

# Only the voice data is taken from brasiltts: the mbrola binary in those
# packages is x86_64 Arch, while the databases are plain data.
RUN git clone --depth 1 --branch "${BRASILTTS_REF}" \
        https://github.com/felipefacundes/brasiltts brasiltts

# The context is taken whole and the package root is located inside it, rather
# than each COPY trusting a fixed layout.
#
# The reason is concrete: Render resolved `COPY deploy/config.toml` against the
# repository root even with `dockerContext` naming this folder, and the build
# died on the last COPY after every install had already run. Locating the
# package here costs one `if` and works whether the context is jarvis-mobile/ or
# the repository root — and if it is neither, it says so with a listing instead
# of a checksum error.
COPY . /opt/ctx
RUN set -eux; \
    if [ -f /opt/ctx/pyproject.toml ]; then \
        src=/opt/ctx; \
    elif [ -f /opt/ctx/jarvis-mobile/pyproject.toml ]; then \
        src=/opt/ctx/jarvis-mobile; \
    else \
        echo 'No jarvis-mobile package in the build context. It holds:' >&2; \
        ls -A /opt/ctx >&2; \
        exit 1; \
    fi; \
    mv "$src" /opt/jarvis-mobile; \
    pip install /opt/jarvis-mobile; \
    python -m jarvis_mobile.deploy --source /opt/jarvis-mobile/web; \
    mkdir -p /data/.openjarvis; \
    cp /opt/jarvis-mobile/deploy/config.toml /data/.openjarvis/config.toml

# The voice data is written whether or not MBROLA itself made it into the
# image, so that installing the binary later is enough. Non-fatal for the same
# reason the package above is: no voice is a degraded backend, not a broken one.
RUN python -m jarvis_mobile.speech.install_voices --source /opt/brasiltts \
    || echo 'WARNING: Brazilian voice data not installed'

# --- the decision model, if this deploy has room for it ---------------------
#
# Ollaya (https://github.com/ollaya-dev/ollaya, Apache-2.0) serves open
# decision models over the wire format TypeSafe's Jev uses. It answers typed
# questions about a sentence with calibrated probabilities in milliseconds and
# never writes a word, so it is not an engine and does not replace the one in
# config.toml -- see src/jarvis_mobile/systemone.py for what it is asked.
#
# OFF BY DEFAULT, and the reason is memory, not taste: the daemon is ~20 MB but
# the model behind it is a few hundred million parameters, which is more than a
# free plan has. Everything that uses it already treats "no decision model" as
# the ordinary case, so leaving this off costs nothing and changes nothing.
#
#   docker build --build-arg WITH_OLLAYA=1 -f deploy/Dockerfile -t jarvis .
#
# The model is pulled here, at build time, on purpose: the free plan has no
# persistent disk, so anything downloaded at run time is downloaded again on
# every restart.
ARG WITH_OLLAYA=0
ARG OLLAYA_MODEL=laya:multilingual
RUN set -eux; \
    if [ "${WITH_OLLAYA}" = "1" ]; then \
      case "$(uname -m)" in \
        x86_64) arch=amd64 ;; \
        aarch64) arch=arm64 ;; \
        *) echo "no ollaya build for $(uname -m)" >&2; exit 1 ;; \
      esac; \
      apt-get update; \
      apt-get install -y --no-install-recommends curl zstd; \
      rm -rf /var/lib/apt/lists/*; \
      curl -fsSL -o /tmp/ollaya.tar.zst \
        "https://github.com/ollaya-dev/ollaya/releases/latest/download/ollaya-linux-${arch}.tar.zst"; \
      tar --zstd -xf /tmp/ollaya.tar.zst -C /usr/local; \
      rm /tmp/ollaya.tar.zst; \
      ollaya --version || true; \
      OLLAYA_MODELS=/opt/ollaya-models ollaya serve & \
      for i in $(seq 30); do ollaya list >/dev/null 2>&1 && break; sleep 1; done; \
      OLLAYA_MODELS=/opt/ollaya-models ollaya pull "${OLLAYA_MODEL}"; \
      ollaya stop || true; \
    fi

# Where the pulled model lives, and where the daemon listens. Read by the
# entrypoint below and by systemone.py; harmless when nothing was installed.
ENV OLLAYA_MODELS=/opt/ollaya-models \
    OLLAYA_HOST=http://127.0.0.1:11435

# Config and state live under /data, written by the step above. No VOLUME is
# declared here on purpose: whether that path survives a restart is the
# platform's decision, not the image's — Render mounts a disk there on a paid
# plan and ignores it on the free one, and compose mounts a named volume.
# Declaring it would only create anonymous volumes nobody asked for.
ENV HOME=/data

# Loopback would make the server unreachable from outside the container.
ENV JARVIS_HOST=0.0.0.0 \
    JARVIS_PORT=8000
EXPOSE 8000

# Fails the container when the engine is unreachable, which is the failure
# worth restarting on — a wedged engine looks healthy from the process table.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c 'import httpx, os, sys; port = os.environ.get("JARVIS_PORT", "8000"); sys.exit(0 if httpx.get("http://127.0.0.1:" + port + "/health", timeout=8).status_code == 200 else 1)'

# `jarvis-mobile serve`, not `jarvis serve`: same command, with the device
# bridge's WebSocket route mounted. OpenJarvis has no plugin hook for routes,
# so this wrapper is how the phone gets somewhere to dial. With no
# JARVIS_DEVICE_TOKEN set it behaves exactly like `jarvis serve`.
# The decision daemon first, when the image has one, then the server. It is
# backgrounded rather than supervised on purpose: it is an optional extra, and
# a container that dies because an optional extra died would be worse than one
# that simply decides nothing. `ollaya` missing is the ordinary case, so the
# whole clause is guarded by `command -v`.
ENTRYPOINT ["sh", "-c", "if command -v ollaya >/dev/null 2>&1; then ollaya serve >/tmp/ollaya.log 2>&1 & fi; exec jarvis-mobile serve --host \"$JARVIS_HOST\" --port \"$JARVIS_PORT\""]
