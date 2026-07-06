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

# Keep every runtime-writable path under /tmp so the root filesystem can be
# mounted READ-ONLY in the deployment (--read-only + a tmpfs /tmp). Without
# this, matplotlib's Agg backend (headless render, app.py `_render`) and
# fontconfig try to write caches under $HOME and crash on a read-only FS.
# app.py's export TemporaryDirectory + per-session tmpdirs already live in /tmp.
ENV MPLCONFIGDIR=/tmp/mpl \
    XDG_CACHE_HOME=/tmp/cache \
    HOME=/tmp/home \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# app.py plus the modules generated scripts / post-export checks import:
# sdf_kit (mesh-mode implicit modeling), networks + fea + fit (checks,
# MTR-179/180/204). fit.py is imported by app.py's `checks.fit` path — it MUST
# be copied or that check errors at runtime in the image.
COPY app.py sdf_kit.py networks.py fea.py fit.py ./

# Run as a non-root, no-login user — defense in depth for executing generated
# code (it can never be root inside the container). The base image ships no
# compilers or shells beyond /bin/sh; we add nothing that widens the surface.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin runner \
    && mkdir -p /tmp/mpl /tmp/cache /tmp/home \
    && chown -R runner /tmp/mpl /tmp/cache /tmp/home
USER runner

EXPOSE 8000

# Liveness probe for `docker run` / any orchestrator that honors HEALTHCHECK
# (Railway also probes railway.toml's healthcheckPath). Uses stdlib urllib —
# no curl in the slim image. Hits 8000 (the EXPOSE default); on Railway the
# platform probes the injected $PORT via railway.toml instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"

# DEPLOYMENT HARDENING (MTR-187) — the container is the trust boundary; these
# runtime controls are the REAL isolation and MUST be set on the platform (they
# cannot be baked into the image). On Railway/any Docker host, run with:
#   --read-only                 (root FS immutable; writable /tmp is tmpfs)
#   --tmpfs /tmp:rw,noexec,nosuid,size=2g
#   --cap-drop=ALL              (no Linux capabilities)
#   --security-opt=no-new-privileges
#   --network=none OR egress-restricted   (the sidecar needs NO outbound net;
#                                          the app makes all LLM/fal calls)
#   memory + CPU limits         (physical-RAM bound; app.py rlimits are layer 2)
# See cad-runner/README.md "Security" for what IS vs ISN'T enforced in-process
# and the residual risks that gate non-owner access (gVisor/microVM — MTR-187).
#
# Shell form so ${PORT} expands at runtime: Railway (and most PaaS) inject the
# listening port via $PORT. Falls back to 8000 for local `docker run`.
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
