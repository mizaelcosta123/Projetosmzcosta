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

# espeak-ng turns text into phonemes and MBROLA turns phonemes into a voice, so
# the container speaks Portuguese with no network and no model. git is only
# needed to fetch OpenJarvis and the voice data during the build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git ca-certificates espeak-ng mbrola \
    && rm -rf /var/lib/apt/lists/*

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
RUN pip install \
        click croniter httpx rich tomlkit websockets pyyaml \
        fastapi uvicorn python-multipart pydantic

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

COPY . /opt/jarvis-mobile
RUN pip install /opt/jarvis-mobile \
    && python -m jarvis_mobile.speech.install_voices --source /opt/brasiltts \
    && python -m jarvis_mobile.deploy --source /opt/jarvis-mobile/web

# Config and state live under /data. No VOLUME is declared here on purpose:
# whether that path survives a restart is the platform's decision, not the
# image's — Render mounts a disk there on a paid plan and ignores it on the
# free one, and compose mounts a named volume. Declaring it would only create
# anonymous volumes nobody asked for.
ENV HOME=/data
RUN mkdir -p /data/.openjarvis
COPY deploy/config.toml /data/.openjarvis/config.toml

# Loopback would make the server unreachable from outside the container.
ENV JARVIS_HOST=0.0.0.0 \
    JARVIS_PORT=8000
EXPOSE 8000

# Fails the container when the engine is unreachable, which is the failure
# worth restarting on — a wedged engine looks healthy from the process table.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import httpx,os,sys; sys.exit(0 if httpx.get(f'http://127.0.0.1:{os.environ.get(\"JARVIS_PORT\",\"8000\")}/health', timeout=8).status_code == 200 else 1)"

ENTRYPOINT ["sh", "-c", "exec jarvis serve --host \"$JARVIS_HOST\" --port \"$JARVIS_PORT\""]
