/**
 * Camera math for "Update preview" — carrying the angle a creator
 * picked in the file-detail viewer over to the offscreen capture rig.
 *
 * The two rigs do NOT share a coordinate system, so a camera position
 * cannot simply be copied between them:
 *
 * - The detail viewer (`ModelViewer`, non-`fixedFrame`) renders the
 *   model at its native scale — millimetres, for an STL — inside drei's
 *   `<Stage adjustCamera={1.2}>`, which repositions the camera on mount
 *   to fit whatever it measures. Field of view 45°.
 * - The capture rig (`ThumbnailCapture`) normalizes every model to a
 *   fixed `TARGET_WORLD_SIZE` and shoots it from a fixed distance at
 *   field of view 40°.
 *
 * What IS portable between them is what the viewer actually looks like:
 * the direction the camera sits in relative to the model, and how much
 * of the frame the model fills. `framing` below is that second number —
 * the fraction of the viewport's height spanned by the model's largest
 * dimension. Preserving it reproduces the creator's zoom faithfully in
 * a rig with a different scale and a different lens.
 */

export const CAPTURE_FOV = 40;
export const CAPTURE_TARGET_WORLD_SIZE = 2.4;
export const CAPTURE_DEFAULT_DISTANCE = 4.5;

/**
 * Margin drei `<Stage adjustCamera>` passes to `<Bounds>` when we hand
 * it `1.2`. Kept as a named constant so the saved-view restorer and the
 * Stage prop cannot drift apart — the baseline distance a capture was
 * measured against is exactly `Bounds.getSize().distance` at this margin.
 */
export const STAGE_FIT_MARGIN = 1.2;

/**
 * Whether Stage should auto-fit. When a saved preview view is present we
 * own the camera ourselves (`ApplyInitialView`) and must keep Stage's
 * `fit()` off for the whole mount — even a single late Refit after we
 * place the camera snaps it back to head-on (CON-27).
 */
export function stageAdjustCamera(hasInitialView: boolean): false | number {
  return hasInitialView ? false : STAGE_FIT_MARGIN;
}

/**
 * Fit distance drei `<Bounds getSize()>` would report for a model of
 * `maxDim` at the given lens, using Stage's margin.
 *
 * Deliberately mirrors Bounds' `atan` (not `tan`) form so a restored
 * view anchors on the same baseline the capture measured against when
 * Stage was still auto-fitting. Used when Stage auto-fit is disabled
 * for a saved view — `Number(false)` would otherwise zero the margin
 * and make `getSize().distance` unusable.
 */
export function stageFitDistance(
  maxDim: number,
  fovDeg: number,
  aspect: number,
  margin: number = STAGE_FIT_MARGIN
): number {
  if (!(maxDim > 0) || !(fovDeg > 0) || !(aspect > 0) || !(margin > 0)) {
    return 0;
  }
  const fitHeightDistance =
    maxDim / (2 * Math.atan((Math.PI * fovDeg) / 360));
  const fitWidthDistance = fitHeightDistance / aspect;
  return margin * Math.max(fitHeightDistance, fitWidthDistance);
}

/**
 * Framing bounds for a captured snapshot.
 *
 * A creator can orbit to a legitimate angle while zoomed absurdly far
 * in or out — the viewer allows it, and a thumbnail shot that way is
 * either a texture-less close-up of one facet or a speck. The angle is
 * the thing worth preserving; the zoom gets clamped to a range that
 * still reads as a product shot. The upper bound stops just short of
 * 1 so the part never touches the frame edge.
 */
export const MIN_FRAMING = 0.35;
export const MAX_FRAMING = 0.95;

/** A camera angle + zoom, in rig-independent terms. */
export interface PreviewView {
  /** Unit vector from the model's centre toward the camera. */
  direction: [number, number, number];
  /**
   * Fraction of the viewport height spanned by the model's largest
   * dimension. ~0.73 is the capture rig's own default framing.
   */
  framing: number;
}

const DEG = Math.PI / 180;

/** Half-height of the view frustum at `distance`, for a vertical `fovDeg`. */
function halfExtentAt(distance: number, fovDeg: number): number {
  return distance * Math.tan((fovDeg * DEG) / 2);
}

/**
 * What fraction of the viewport height a model of `maxDim` spans when
 * viewed from `distance` through a `fovDeg` lens.
 */
export function framingFraction(
  maxDim: number,
  distance: number,
  fovDeg: number
): number {
  const visibleHeight = 2 * halfExtentAt(distance, fovDeg);
  if (!(visibleHeight > 0) || !(maxDim > 0)) return 0;
  return maxDim / visibleHeight;
}

/** The inverse: how far back to sit for a given `framing`. */
export function distanceForFraming(
  maxDim: number,
  framing: number,
  fovDeg: number
): number {
  const visibleHeight = maxDim / framing;
  return visibleHeight / (2 * Math.tan((fovDeg * DEG) / 2));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Normalize a camera offset into a unit direction.
 *
 * Straight-down and straight-up offsets are nudged off the pole: the
 * capture rig orients itself with `lookAt` against a +Y up vector, and
 * an offset exactly parallel to it makes the cross product degenerate,
 * which spins the model to an arbitrary roll. A ~0.6° tilt is invisible
 * in the shot and keeps the orientation well-defined.
 */
export function normalizeDirection(
  offset: [number, number, number]
): [number, number, number] {
  const [x, y, z] = offset;
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) return [0, 0, 1];

  let dx = x / length;
  let dy = y / length;
  let dz = z / length;

  const horizontal = Math.hypot(dx, dz);
  const MIN_HORIZONTAL = 0.01;
  if (horizontal < MIN_HORIZONTAL) {
    dz = MIN_HORIZONTAL;
    dy = Math.sign(dy || 1) * Math.sqrt(1 - MIN_HORIZONTAL * MIN_HORIZONTAL);
    dx = 0;
  }

  return [dx, dy, dz];
}

/** The framing the automatic first-capture already uses. */
export function defaultFraming(): number {
  return framingFraction(
    CAPTURE_TARGET_WORLD_SIZE,
    CAPTURE_DEFAULT_DISTANCE,
    CAPTURE_FOV
  );
}

/**
 * Turn the detail viewer's live orbit state into a portable view.
 *
 * `baselineDistance` is the camera-to-target distance once the viewer
 * has settled on its own automatic fit — drei's `<Stage adjustCamera>`
 * frames the model on load, and that settled distance is what we treat
 * as "the default shot". Anchoring to it is what makes this rig-
 * independent: we never need the model's dimensions, its units, or the
 * viewer's field of view, because framing at a fixed fov varies purely
 * as the inverse of distance. Halve the distance and the model spans
 * twice the frame.
 *
 * Defining the viewer's settled fit as equal to the capture rig's own
 * default framing also gives the behaviour a creator would expect:
 * press Update preview without touching the zoom and you get the same
 * framing the automatic capture produced, just from your angle.
 *
 * Measuring the scene instead was the obvious alternative and it is a
 * trap — `<Stage>` defaults to `shadows="contact"`, so the scene graph
 * carries a `ContactShadows` ground plane far larger than the part, and
 * a bounding box over it reports the shadow catcher's size, not the
 * model's.
 */
export function previewViewFromOrbit(params: {
  /** Camera position minus OrbitControls target, viewer world units. */
  offset: [number, number, number];
  /** Camera-to-target distance at the viewer's settled automatic fit. */
  baselineDistance: number;
}): PreviewView {
  const { offset, baselineDistance } = params;
  const distance = Math.hypot(offset[0], offset[1], offset[2]);

  const usable = distance > 0 && baselineDistance > 0;
  const framing = usable
    ? clamp(
        defaultFraming() * (baselineDistance / distance),
        MIN_FRAMING,
        MAX_FRAMING
      )
    : defaultFraming();

  return { direction: normalizeDirection(offset), framing };
}

/**
 * Place the capture rig's camera so it reproduces `view` against a
 * model normalized to `CAPTURE_TARGET_WORLD_SIZE` at the origin.
 */
export function capturePositionFor(
  view: PreviewView
): [number, number, number] {
  const framing = clamp(
    view.framing > 0 ? view.framing : defaultFraming(),
    MIN_FRAMING,
    MAX_FRAMING
  );
  const distance = distanceForFraming(
    CAPTURE_TARGET_WORLD_SIZE,
    framing,
    CAPTURE_FOV
  );
  const [dx, dy, dz] = normalizeDirection(view.direction);
  return [dx * distance, dy * distance, dz * distance];
}

/**
 * The inverse of `previewViewFromOrbit`: where to put the DETAIL
 * VIEWER's camera so it reproduces a saved view.
 *
 * Same anchor, used the other way round. The viewer's settled
 * automatic fit is defined as equal to the capture rig's default
 * framing, so a saved framing of exactly `defaultFraming()` returns
 * the baseline distance unchanged — a file whose owner never touched
 * the zoom opens at precisely the fit the viewer would have chosen for
 * itself, just rotated to their angle.
 *
 * Framing at a fixed field of view is purely the inverse of distance,
 * so the conversion needs neither the model's dimensions nor the
 * viewer's lens.
 */
export function viewerDistanceForFraming(
  baselineDistance: number,
  framing: number
): number {
  if (!(baselineDistance > 0) || !(framing > 0)) return baselineDistance;
  const clamped = clamp(framing, MIN_FRAMING, MAX_FRAMING);
  return baselineDistance * (defaultFraming() / clamped);
}

/**
 * Camera position that reproduces `view` in the detail viewer, given
 * the controls' target and the distance at the viewer's settled fit.
 */
export function viewerCameraPositionFor(params: {
  view: PreviewView;
  target: [number, number, number];
  baselineDistance: number;
}): [number, number, number] {
  const [dx, dy, dz] = normalizeDirection(params.view.direction);
  const distance = viewerDistanceForFraming(
    params.baselineDistance,
    params.view.framing
  );
  return [
    params.target[0] + dx * distance,
    params.target[1] + dy * distance,
    params.target[2] + dz * distance,
  ];
}

/**
 * Read a saved view off a file row. Returns null unless all four
 * values are present and the direction is non-degenerate — a
 * partially-written row must fall back to the viewer's own framing
 * rather than aim the camera at nothing.
 */
export function savedPreviewView(row: {
  previewDirX: number | null;
  previewDirY: number | null;
  previewDirZ: number | null;
  previewFraming: number | null;
}): PreviewView | null {
  const { previewDirX: x, previewDirY: y, previewDirZ: z } = row;
  const framing = row.previewFraming;
  if (x == null || y == null || z == null || framing == null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  if (!Number.isFinite(framing) || framing <= 0) return null;
  if (Math.hypot(x, y, z) === 0) return null;
  return { direction: normalizeDirection([x, y, z]), framing };
}
