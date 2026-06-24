# CAD execution sidecar. build123d pulls in the OpenCASCADE kernel (OCP),
# so the image is large — that's expected.
FROM python:3.12-slim

# OpenCASCADE / OpenGL runtime libs build123d + trimesh rendering need.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglu1-mesa libxrender1 libxext6 libsm6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

# Run as a non-root user — defense in depth for executing generated code.
RUN useradd --create-home --uid 10001 runner
USER runner

EXPOSE 8000

# NOTE (deployment hardening — see plan): run this container with NO
# outbound network, a read-only root filesystem, and memory/CPU caps.
# Those container-level controls are the real trust boundary; the
# per-run rlimits + timeout in app.py are a second layer.
# Shell form so ${PORT} expands at runtime: Railway (and most PaaS) inject
# the listening port via $PORT and probe the healthcheck on it. Falls back to
# 8000 for local `docker run`.
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
