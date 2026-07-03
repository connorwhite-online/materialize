# CAD execution sidecar. build123d pulls in the OpenCASCADE kernel (OCP),
# so the image is large — that's expected.
FROM python:3.12-slim

# OpenCASCADE / OpenGL runtime libs build123d + trimesh rendering need.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglu1-mesa libxrender1 libxext6 libsm6 \
    && rm -rf /var/lib/apt/lists/*

# Tame the scientific-Python stack's VIRTUAL-memory footprint so it fits inside
# the per-run RLIMIT_AS cap (app.py). glibc malloc reserves up to
# 8 x ncpu x 64MB of arenas, and BLAS/OpenMP reserve per-thread pools — on a
# multi-core host that's several GB of address space mapped at import, which
# can trip the cap and abort OpenCASCADE before any user code runs (the symptom
# is "worker produced no result"). One arena + single-threaded BLAS keeps it
# lean; the CAD workload is OpenCASCADE-bound, not BLAS-bound, so this costs
# effectively nothing. These are baked into the image so deployments don't have
# to hand-set them.
ENV MALLOC_ARENA_MAX=2 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# app.py plus the modules generated scripts / post-export checks import:
# sdf_kit (mesh-mode implicit modeling), networks + fea (checks, MTR-179/180).
COPY app.py sdf_kit.py networks.py fea.py ./

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
