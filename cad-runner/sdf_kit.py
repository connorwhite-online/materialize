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

v2 adds TPMS lattice fields (gyroid / schwarz_p / diamond), region masking,
shell/offset field operators, point-warp transforms, and `from_mesh` — the
B-rep bridge that turns any trimesh (e.g. a tessellated build123d flange) into
an SDF you can smin into an implicit body.

Importable by sidecar-exec'd model code: `from sdf_kit import *`.
"""
import numpy as np
from scipy import ndimage
from skimage import measure
import trimesh

__all__ = [
    "smin", "smax", "subtract", "union", "intersect",
    "sphere", "box", "capsule", "cyl_z", "sq_prism",
    "gyroid", "schwarz_p", "diamond",
    "mask", "shell_field", "offset_field",
    "translate", "rotate_z",
    "from_mesh", "to_mesh", "split_shell",
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


def sq_prism(P, a, b, n, z0, z1):
    """Superellipse prism (|x/a|^n + |y/b|^n = 1 cross-section, z-extruded) —
    the measured plan-form language of premium enclosures (see
    docs/text-to-cad/design-studies/modem-works.md): n~4.5 reads as a
    squircle desk device, n~1.7-2.2 as a handheld lens/pebble. Use this for
    organic product shells INSTEAD of a box with corner fillets — a
    superellipse has no straight-to-arc tangency breaks, which is what makes
    the form read as designed. Pseudo-distance (monotone, ~mm near the
    surface); pair with offset_field for uniform thin walls."""
    r = (np.abs(P[:, 0] / a) ** n + np.abs(P[:, 1] / b) ** n) ** (1.0 / n)
    d2 = (r - 1.0) * min(a, b)
    return np.maximum(d2, np.maximum(P[:, 2] - z1, z0 - P[:, 2]))


def cyl_z(P, x, y, r, z0, z1):
    """Flat-capped vertical cylinder (Z axis) — for exact bosses + bolt holes.
    Pass z0<z1 for a boss; extend past the body for a through-hole."""
    dr = np.hypot(P[:, 0] - x, P[:, 1] - y) - r
    dz = np.abs(P[:, 2] - 0.5 * (z0 + z1)) - 0.5 * (z1 - z0)
    outside = np.linalg.norm(np.maximum(np.stack([dr, dz], 1), 0.0), axis=1)
    inside = np.minimum(np.maximum(dr, dz), 0.0)
    return outside + inside


# ---- TPMS lattices ----------------------------------------------------------
# The raw trig fields are NOT distances — their spatial gradient magnitude is
# ~2π/cell, not 1, and it varies across the cell. Each field below divides the
# raw value by its analytic per-point gradient magnitude (first-order Taylor),
# so `thickness` means real millimeters of wall (within a few % near the
# surface; verified by measuring meshed sheets in the test suite). The gradient
# magnitude is floored away from critical points so the far-field stays
# bounded (sign is always exact; only far-from-surface magnitudes are approx).

def _thickness_at(thickness, P):
    """Resolve scalar / per-point array / callable(P) thickness — graded cores
    pass a callable and get a spatially varying wall."""
    if callable(thickness):
        return np.asarray(thickness(P), float)
    return np.asarray(thickness, float)


def _tpms(g, gx, gy, gz, w, thickness, P, solid):
    grad = w * np.sqrt(gx * gx + gy * gy + gz * gz)
    d = g / np.maximum(grad, 0.15 * w)
    t = _thickness_at(thickness, P)
    if solid:
        # one network: everything on the g<0 side, fattened by t/2 past the
        # level surface. t=0 keeps exactly half of space.
        return d - 0.5 * t
    # sheet: a t-thick wall on the level surface — the two-network separator
    # (heat-exchanger core). The two voids it leaves are fully disjoint.
    return np.abs(d) - 0.5 * t


def gyroid(P, cell, thickness, solid=False):
    """Gyroid TPMS. `cell` = lattice period in mm; `thickness` = wall in mm
    (scalar, per-point array, or callable(P) for graded density). Default sheet
    form is the two-network separator; solid=True keeps one network as solid
    infill. Clip to a region with `mask` — the field fills all of space."""
    P = np.asarray(P, float)
    w = 2.0 * np.pi / cell
    sx, cx = np.sin(w * P[:, 0]), np.cos(w * P[:, 0])
    sy, cy = np.sin(w * P[:, 1]), np.cos(w * P[:, 1])
    sz, cz = np.sin(w * P[:, 2]), np.cos(w * P[:, 2])
    g = sx * cy + sy * cz + sz * cx
    gx = cx * cy - sz * sx
    gy = cy * cz - sx * sy
    gz = cz * cx - sy * sz
    return _tpms(g, gx, gy, gz, w, thickness, P, solid)


def schwarz_p(P, cell, thickness, solid=False):
    """Schwarz P TPMS (cos x + cos y + cos z) — straighter, boxier channels
    than the gyroid. Same contract as `gyroid`."""
    P = np.asarray(P, float)
    w = 2.0 * np.pi / cell
    sx, sy, sz = (np.sin(w * P[:, i]) for i in range(3))
    cx, cy, cz = (np.cos(w * P[:, i]) for i in range(3))
    g = cx + cy + cz
    return _tpms(g, -sx, -sy, -sz, w, thickness, P, solid)


def diamond(P, cell, thickness, solid=False):
    """Schwarz D (diamond) TPMS — denser strut network than the gyroid at the
    same cell size. Same contract as `gyroid`."""
    P = np.asarray(P, float)
    w = 2.0 * np.pi / cell
    sx, sy, sz = (np.sin(w * P[:, i]) for i in range(3))
    cx, cy, cz = (np.cos(w * P[:, i]) for i in range(3))
    g = sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz
    gx = cx * sy * sz + cx * cy * cz - sx * sy * cz - sx * cy * sz
    gy = sx * cy * sz - sx * sy * cz + cx * cy * cz - cx * sy * sz
    gz = sx * sy * cz - sx * cy * sz - cx * sy * sz + cx * cy * cz
    return _tpms(g, gx, gy, gz, w, thickness, P, solid)


# ---- field operators ---------------------------------------------------------
def mask(field_a, region, k=0.0):
    """Solid only where `region` < 0 — the tool for "gyroid only inside this
    jacket". k=0 is a hard clip; k>0 blends the field into the region wall over
    k mm (smooth intersection)."""
    if k <= 0.0:
        return np.maximum(field_a, region)
    return smax(field_a, region, k)


def shell_field(field, t):
    """Hollow a field into a t-mm-thick wall on its surface: |field| - t/2.
    Operates on evaluated field values, like the combinators."""
    return np.abs(field) - 0.5 * t


def offset_field(field, d):
    """Grow (d>0) or shrink (d<0) a field by d mm: field - d. Rounds convex
    edges by d as a side effect — that is usually the point."""
    return field - d


# ---- point-warp transforms ---------------------------------------------------
# Transforms warp the SAMPLE POINTS, not the field: apply to P *before* passing
# it to a primitive, and that primitive moves by the transform. e.g.
# `sphere(translate(P, (10, 0, 0)), (0, 0, 0), 5)` is a sphere centered at
# x=+10. Compose left-to-right: the outermost warp applies first.

def translate(P, offset):
    """Move a primitive by `offset` mm: evaluates it at P - offset."""
    return np.asarray(P, float) - np.asarray(offset, float)


def rotate_z(P, degrees, center=(0, 0, 0)):
    """Rotate a primitive by `degrees` CCW about a vertical axis through
    `center`: evaluates it at inverse-rotated points."""
    P = np.asarray(P, float)
    c = np.asarray(center, float)
    a = -np.radians(degrees)
    ca, sa = np.cos(a), np.sin(a)
    Q = P - c
    out = np.empty_like(P)
    out[:, 0] = ca * Q[:, 0] - sa * Q[:, 1]
    out[:, 1] = sa * Q[:, 0] + ca * Q[:, 1]
    out[:, 2] = Q[:, 2]
    return out + c


# ---- B-rep bridge ------------------------------------------------------------
def _crossing_parity(mesh, pts, rng):
    """Point-in-solid by ray-crossing parity (odd crossings = inside), pure
    numpy Möller–Trumbore over all triangles. Orientation-INDEPENDENT — it
    survives inconsistent winding and `fix_normals`-flipped cavity shells,
    which vertex/face-normal side tests do not. Random ray directions make
    edge/vertex grazes measure-zero. O(len(pts) * faces): only for the handful
    of classification samples below, never per-voxel."""
    tri = mesh.triangles
    v0 = tri[:, 0]
    e1 = tri[:, 1] - v0
    e2 = tri[:, 2] - v0
    inside = np.zeros(len(pts), bool)
    for i, o in enumerate(pts):
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        p = np.cross(d, e2)
        det = np.einsum("ij,ij->i", e1, p)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        tvec = o - v0
        u = np.einsum("ij,ij->i", tvec, p) * inv
        q = np.cross(tvec, e1)
        v = np.einsum("j,ij->i", d, q) * inv
        t = np.einsum("ij,ij->i", e2, q) * inv
        hits = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9)
        inside[i] = (int(hits.sum()) % 2) == 1
    return inside


def _solid_voxels(mesh, pitch, pad=2):
    """Voxel occupancy of a mesh's solid material at `pitch`, padded by `pad`
    void voxels per side. Returns (bool grid, world coords of voxel (0,0,0)
    center). Surface voxels come from trimesh voxelization; each enclosed
    pocket is then classified material-vs-cavity by ray-parity majority vote
    over a few sample voxels, so internal channels stay VOID — a naive
    `fill()` would pave over them and break both `from_mesh` and the network
    verifier."""
    vg = mesh.voxelized(pitch)
    origin = np.asarray(vg.transform, float)[:3, 3] - pad * pitch
    surf = np.pad(np.asarray(vg.matrix, bool), pad)
    # 6-connected labeling of non-surface space: a closed voxel shell can leak
    # diagonally under 26-connectivity, which would misclassify interiors.
    lbl, n = ndimage.label(~surf)
    open_air = set()
    for face in (lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1], lbl[:, :, 0], lbl[:, :, -1]):
        open_air.update(np.unique(face))
    open_air.discard(0)
    solid = surf.copy()
    rng = np.random.default_rng(0)  # deterministic runs
    enclosed, samples = [], []
    for lab in range(1, n + 1):
        if lab in open_air:
            continue
        vox = np.argwhere(lbl == lab)
        take = vox[:: max(1, len(vox) // 5)][:5]
        enclosed.append((lab, len(samples), len(take)))
        samples.extend(origin + take * pitch)
    if enclosed:
        inside = _crossing_parity(mesh, np.asarray(samples), rng)
        for lab, start, count in enclosed:
            if np.mean(inside[start:start + count]) >= 0.5:
                solid[lbl == lab] = True
    return solid, origin


def from_mesh(mesh, pitch=1.0):
    """SDF of an arbitrary trimesh — the B-rep bridge. Build a flange in
    build123d, tessellate it, wrap it here, then smin it into an implicit
    body. Precomputes a signed voxel grid at `pitch` (occupancy + euclidean
    distance transform inside and out) and returns a `field(P)` callable that
    trilinearly interpolates it. Accuracy is ~pitch/2 near the surface; points
    outside the grid get a positive bounding-sphere distance (large and
    positive, so smin composition stays sane). Cost is paid once up front —
    queries are cheap."""
    solid, origin = _solid_voxels(mesh, pitch, pad=3)
    grid = (ndimage.distance_transform_edt(~solid)
            - ndimage.distance_transform_edt(solid)) * pitch
    # EDT measures center-to-center; the true surface sits between a solid and
    # a void voxel center, so pull both sides in by half a voxel.
    grid -= 0.5 * pitch * np.sign(grid)
    n = np.asarray(grid.shape, float)
    center = origin + 0.5 * (n - 1) * pitch
    r_bound = 0.5 * pitch * float(np.linalg.norm(n - 1))

    def field(P):
        P = np.asarray(P, float)
        idx = (P - origin) / pitch
        in_grid = np.all((idx >= 0.0) & (idx <= n - 1), axis=1)
        out = np.maximum(np.linalg.norm(P - center, axis=1) - r_bound, pitch)
        if np.any(in_grid):
            out[in_grid] = ndimage.map_coordinates(
                grid, idx[in_grid].T, order=1, mode="nearest")
        return out

    return field


def split_shell(body_field, cavity_field, z_split, lip_h=3.0, lip_t=1.1,
                fit_gap=0.25):
    """Split a draped shell into two watertight printed-fit halves — the
    keystone of the drape-and-split enclosure recipe (docs/text-to-cad/
    design-studies/modem-works.md): soft skin outside, component cavity
    inside, two pieces joined on an inner lip. Returns (bottom, top) field
    callables. The bottom keeps a lip ring (the innermost lip_t of the wall,
    rising lip_h above the split, fused 1mm into its own wall); the top gets
    the matching recess grown by fit_gap — a real printed clearance you can
    assert numerically. Keep lip_t comfortably under the wall thickness. Cut port/connector
    apertures AFTER splitting (subtract from both returned fields) so they
    notch the lip like a real product seam — the ring is built from the
    cavity and cannot know about ports."""
    def bottom(P):
        c = cavity_field(P)
        below = np.maximum(body_field(P), P[:, 2] - z_split)
        ring = np.maximum(
            np.maximum(-c, c - lip_t),
            np.maximum(P[:, 2] - (z_split + lip_h), (z_split - 1.0) - P[:, 2]),
        )
        return np.minimum(below, ring)

    def top(P):
        c = cavity_field(P)
        above = np.maximum(body_field(P), z_split - P[:, 2])
        recess = np.maximum(
            np.maximum(-(c + fit_gap), c - (lip_t + fit_gap)),
            np.maximum(P[:, 2] - (z_split + lip_h + fit_gap),
                       (z_split - 0.5) - P[:, 2]),
        )
        return np.maximum(above, -recess)

    return bottom, top


# ---- meshing ---------------------------------------------------------------
_CELL_BUDGET = 8_000_000
def to_mesh(field, lo, hi, pitch=0.7):
    """Evaluate `field(P)->(N,) sdf` on a grid over [lo,hi] (mm) and
    marching-cubes the level-0 surface into a watertight trimesh. The grid is
    padded with 'void' so the surface always closes. Grids over 8M cells are
    refused before allocation with an error naming a pitch that fits — a
    self-explanatory failure the repair loop can act on."""
    lo = np.asarray(lo, float); hi = np.asarray(hi, float)
    n = [int(np.ceil((hi[i] - lo[i]) / pitch)) + 1 for i in range(3)]
    cells = n[0] * n[1] * n[2]
    if cells > _CELL_BUDGET:
        ext = hi - lo
        p = float(np.prod(ext) / _CELL_BUDGET) ** (1.0 / 3.0)
        p = max(np.ceil(p * 10.0) / 10.0, 0.1)
        while np.prod([int(np.ceil(e / p)) + 1 for e in ext]) > _CELL_BUDGET:
            p = round(p + 0.1, 1)
        raise ValueError(
            f"grid {n[0]}x{n[1]}x{n[2]} = {cells / 1e6:.1f}M cells exceeds "
            f"the {_CELL_BUDGET // 1_000_000}M budget — use pitch >= {p:g}")
    axes = [np.linspace(lo[i], hi[i], n[i]) for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    F = np.asarray(field(P), float).reshape(*n)
    F = np.pad(F, 1, mode="constant", constant_values=float(pitch * 3 + 1.0))
    # Exact zeros happen whenever a hard clip (mask/subtract) lands on a grid
    # coordinate; marching cubes then emits coincident vertices there and the
    # merge below welds them into non-manifold edges. Nudge them off the level
    # by more than the vertex-merge tolerance (shifts the surface ~1e-4 voxels
    # at those nodes — far below print resolution).
    F[F == 0.0] = -1e-4 * pitch
    verts, faces, _, _ = measure.marching_cubes(F, level=0.0)
    for i in range(3):
        verts[:, i] = lo[i] + (verts[:, i] - 1.0) * (hi[i] - lo[i]) / (n[i] - 1)
    m = trimesh.Trimesh(vertices=verts, faces=faces)
    m.merge_vertices()
    m.fix_normals()
    return m
