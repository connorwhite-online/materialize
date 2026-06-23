"""
SDF toolkit for the text-to-CAD "functional skeleton + organic skin" path
(Tier 1). The model defines EXACT functional anchors (bosses, holes, faces) and
smooth-unions an ORGANIC connecting body, then `to_mesh` marching-cubes it to a
watertight trimesh. This is how you get organic, load-path-looking forms that
still hold real tolerances — beauty draped over fixed function, not a pile of
joined primitives (and not an unconstrained generative blob).

All primitives are vectorized: they take P, an (N,3) array of sample points, and
return an (N,) signed distance (negative inside the solid). Compose with smin
(smooth union), subtract (cut), and smax (smooth intersect).

Importable by sidecar-exec'd model code: `from sdf_kit import *`.
"""
import numpy as np
from skimage import measure
import trimesh

__all__ = [
    "smin", "smax", "subtract", "union", "intersect",
    "sphere", "box", "capsule", "cyl_z", "to_mesh",
]


# ---- combinators -----------------------------------------------------------
def smin(a, b, k):
    """Smooth union (the organic-blend workhorse). k = blend radius in mm."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    """Smooth intersection."""
    return -smin(-a, -b, k)


def union(a, b):
    return np.minimum(a, b)


def intersect(a, b):
    return np.maximum(a, b)


def subtract(d, hole):
    """Cut `hole` out of `d` (hard edge — use for exact bores/pockets)."""
    return np.maximum(d, -hole)


# ---- primitives (negative = inside) ----------------------------------------
def sphere(P, center, r):
    return np.linalg.norm(P - np.asarray(center, float), axis=1) - r


def box(P, center, half):
    """Axis-aligned box. `half` = (hx, hy, hz) half-extents."""
    q = np.abs(P - np.asarray(center, float)) - np.asarray(half, float)
    return (
        np.linalg.norm(np.maximum(q, 0.0), axis=1)
        + np.minimum(np.max(q, axis=1), 0.0)
    )


def capsule(P, a, b, r):
    """Round-capped capsule from a to b (any axis) — the organic strut."""
    a = np.asarray(a, float); b = np.asarray(b, float); ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0.0, 1.0)[:, None]
    return np.linalg.norm(P - (a + t * ab), axis=1) - r


def cyl_z(P, x, y, r, z0, z1):
    """Flat-capped vertical cylinder (Z axis) — for exact bosses + bolt holes.
    Pass z0<z1 for a boss; extend past the body for a through-hole."""
    dr = np.hypot(P[:, 0] - x, P[:, 1] - y) - r
    dz = np.abs(P[:, 2] - 0.5 * (z0 + z1)) - 0.5 * (z1 - z0)
    outside = np.linalg.norm(np.maximum(np.stack([dr, dz], 1), 0.0), axis=1)
    inside = np.minimum(np.maximum(dr, dz), 0.0)
    return outside + inside


# ---- meshing ---------------------------------------------------------------
def to_mesh(field, lo, hi, pitch=0.7):
    """Evaluate `field(P)->(N,) sdf` on a grid over [lo,hi] (mm) and
    marching-cubes the level-0 surface into a watertight trimesh. The grid is
    padded with 'void' so the surface always closes. Keep pitch >= ~0.4 and the
    box modest so the grid stays under a few million cells."""
    lo = np.asarray(lo, float); hi = np.asarray(hi, float)
    n = [int(np.ceil((hi[i] - lo[i]) / pitch)) + 1 for i in range(3)]
    axes = [np.linspace(lo[i], hi[i], n[i]) for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    F = np.asarray(field(P), float).reshape(*n)
    F = np.pad(F, 1, mode="constant", constant_values=float(pitch * 3 + 1.0))
    verts, faces, _, _ = measure.marching_cubes(F, level=0.0)
    for i in range(3):
        verts[:, i] = lo[i] + (verts[:, i] - 1.0) * (hi[i] - lo[i]) / (n[i] - 1)
    m = trimesh.Trimesh(vertices=verts, faces=faces)
    m.merge_vertices()
    m.fix_normals()
    return m
