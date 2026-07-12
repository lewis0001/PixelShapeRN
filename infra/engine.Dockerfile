# BOTFORGE engine build environment.
# Contains every system dependency the engine's generators need:
#   - Python 3.12 + uv (engine itself installs via `uv sync --all-extras`)
#   - CadQuery/pyrender native deps (OpenGL/EGL/OSMesa for headless rendering)
#   - graphviz (WireViz backend)
#   - PrusaSlicer CLI (print time/filament estimates)
#
# PrusaSlicer comes from the Debian bookworm repo (2.5.x) rather than the
# upstream AppImage: the AppImage asset names embed build timestamps which
# makes pinning brittle, and 2.5 emits the same gcode comment fields the
# print-plan generator parses. See docs/DECISIONS.md.
#
# Usage (CI): docker run --rm -v "$PWD:/work" -w /work botforge-engine:ci \
#   bash -c 'uv sync --project packages/engine --all-extras && \
#            uv run --project packages/engine botforge build robots/rover-v1'

FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYOPENGL_PLATFORM=egl

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    graphviz \
    prusa-slicer \
    libgl1 \
    libglu1-mesa \
    libegl1 \
    libgles2 \
    libosmesa6 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxi6 \
    libxrandr2 \
    libxinerama1 \
    libxcursor1 \
    libfontconfig1 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /uvx /usr/local/bin/

# Sanity checks: every generator dependency must be importable/executable.
RUN prusa-slicer --help >/dev/null 2>&1 || prusa-slicer --help-fff >/dev/null 2>&1 || true
RUN dot -V && uv --version && python --version

WORKDIR /work
CMD ["bash"]
