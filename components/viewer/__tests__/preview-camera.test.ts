import { describe, it, expect } from "vitest";
import {
  savedPreviewView,
  viewerCameraPositionFor,
  viewerDistanceForFraming,
  CAPTURE_DEFAULT_DISTANCE,
  CAPTURE_FOV,
  CAPTURE_TARGET_WORLD_SIZE,
  MAX_FRAMING,
  MIN_FRAMING,
  STAGE_FIT_MARGIN,
  boundsMeasurementStable,
  capturePositionFor,
  defaultFraming,
  distanceForFraming,
  framingFraction,
  normalizeDirection,
  previewOrbitOffset,
  previewViewFromOrbit,
  stageAdjustCamera,
  stageFitDistance,
} from "../preview-camera";

const length = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

describe("framingFraction / distanceForFraming", () => {
  it("round-trips", () => {
    const framing = framingFraction(2.4, 4.5, 40);
    expect(distanceForFraming(2.4, framing, 40)).toBeCloseTo(4.5, 10);
  });

  it("is inversely proportional to distance — the property the baseline math rests on", () => {
    const near = framingFraction(2.4, 4.5, 40);
    const far = framingFraction(2.4, 9, 40);
    expect(near / far).toBeCloseTo(2, 10);
  });

  it("returns 0 for a degenerate model or camera rather than NaN", () => {
    expect(framingFraction(0, 4.5, 40)).toBe(0);
    expect(framingFraction(2.4, 0, 40)).toBe(0);
  });
});

describe("normalizeDirection", () => {
  it("returns a unit vector", () => {
    expect(length(normalizeDirection([3, 0, 4]))).toBeCloseTo(1, 10);
    expect(length(normalizeDirection([-12, 5, 84]))).toBeCloseTo(1, 10);
  });

  it("preserves direction", () => {
    expect(normalizeDirection([0, 0, 9])).toEqual([0, 0, 1]);
    const d = normalizeDirection([3, 0, 4]);
    expect(d[0]).toBeCloseTo(0.6, 10);
    expect(d[2]).toBeCloseTo(0.8, 10);
  });

  it("nudges a pole-aligned offset off the up axis", () => {
    // Straight down/up makes lookAt's cross product against +Y
    // degenerate, which rolls the model to an arbitrary angle.
    const top = normalizeDirection([0, 10, 0]);
    expect(Math.hypot(top[0], top[2])).toBeGreaterThan(0);
    expect(length(top)).toBeCloseTo(1, 10);
    expect(top[1]).toBeGreaterThan(0.99);

    const bottom = normalizeDirection([0, -10, 0]);
    expect(Math.hypot(bottom[0], bottom[2])).toBeGreaterThan(0);
    expect(length(bottom)).toBeCloseTo(1, 10);
    expect(bottom[1]).toBeLessThan(-0.99);
  });

  it("falls back to a head-on direction for a zero offset", () => {
    expect(normalizeDirection([0, 0, 0])).toEqual([0, 0, 1]);
  });
});

describe("previewViewFromOrbit", () => {
  it("reproduces the automatic capture's framing when the zoom is untouched", () => {
    // Press Update preview without zooming and you should get exactly
    // the framing the automatic first capture produces — only the
    // angle differs.
    const view = previewViewFromOrbit({
      offset: [0, 0, 180],
      baselineDistance: 180,
    });
    expect(view.framing).toBeCloseTo(defaultFraming(), 10);
    expect(capturePositionFor(view)[2]).toBeCloseTo(CAPTURE_DEFAULT_DISTANCE, 8);
  });

  it("is scale-free — the same zoom on a 5mm part and a 500mm part agree", () => {
    const small = previewViewFromOrbit({
      offset: [0, 0, 6],
      baselineDistance: 12,
    });
    const large = previewViewFromOrbit({
      offset: [0, 0, 600],
      baselineDistance: 1200,
    });
    expect(small.framing).toBeCloseTo(large.framing, 10);
  });

  it("makes the model span more of the frame when zoomed in", () => {
    const zoomedIn = previewViewFromOrbit({
      offset: [0, 0, 90],
      baselineDistance: 180,
    });
    expect(zoomedIn.framing).toBeGreaterThan(defaultFraming());
    // Zoomed in → the capture camera sits closer.
    expect(length(capturePositionFor(zoomedIn))).toBeLessThan(
      CAPTURE_DEFAULT_DISTANCE
    );
  });

  it("clamps an absurd zoom-in instead of shooting one facet", () => {
    const view = previewViewFromOrbit({
      offset: [0, 0, 0.5],
      baselineDistance: 180,
    });
    expect(view.framing).toBe(MAX_FRAMING);
  });

  it("clamps an absurd zoom-out instead of shooting a speck", () => {
    const view = previewViewFromOrbit({
      offset: [0, 0, 5000],
      baselineDistance: 180,
    });
    expect(view.framing).toBe(MIN_FRAMING);
  });

  it("falls back to the default framing when the baseline is unusable", () => {
    expect(
      previewViewFromOrbit({ offset: [0, 0, 180], baselineDistance: 0 }).framing
    ).toBeCloseTo(defaultFraming(), 10);
    expect(
      previewViewFromOrbit({ offset: [0, 0, 0], baselineDistance: 180 }).framing
    ).toBeCloseTo(defaultFraming(), 10);
  });

  it("carries the orbit angle through as a unit direction", () => {
    const view = previewViewFromOrbit({
      // Behind and above the part — the case the head-on auto-capture
      // can never show.
      offset: [0, 100, -100],
      baselineDistance: 180,
    });
    expect(length(view.direction)).toBeCloseTo(1, 10);
    expect(view.direction[1]).toBeGreaterThan(0);
    expect(view.direction[2]).toBeLessThan(0);
  });
});

describe("capturePositionFor", () => {
  it("places the camera along the requested direction", () => {
    const pos = capturePositionFor({
      direction: [0, 1, -1],
      framing: defaultFraming(),
    });
    // Same direction, normalized.
    const d = normalizeDirection([0, 1, -1]);
    const dist = length(pos);
    expect(pos[0] / dist).toBeCloseTo(d[0], 8);
    expect(pos[1] / dist).toBeCloseTo(d[1], 8);
    expect(pos[2] / dist).toBeCloseTo(d[2], 8);
  });

  it("produces a distance that reproduces the requested framing", () => {
    const framing = 0.5;
    const pos = capturePositionFor({ direction: [1, 1, 1], framing });
    expect(
      framingFraction(CAPTURE_TARGET_WORLD_SIZE, length(pos), CAPTURE_FOV)
    ).toBeCloseTo(framing, 10);
  });

  it("clamps a framing supplied out of range", () => {
    const tooClose = capturePositionFor({ direction: [0, 0, 1], framing: 50 });
    expect(
      framingFraction(CAPTURE_TARGET_WORLD_SIZE, length(tooClose), CAPTURE_FOV)
    ).toBeCloseTo(MAX_FRAMING, 10);

    const tooFar = capturePositionFor({ direction: [0, 0, 1], framing: 0.001 });
    expect(
      framingFraction(CAPTURE_TARGET_WORLD_SIZE, length(tooFar), CAPTURE_FOV)
    ).toBeCloseTo(MIN_FRAMING, 10);
  });

  it("survives a zero framing without producing NaN", () => {
    const pos = capturePositionFor({ direction: [0, 0, 1], framing: 0 });
    expect(Number.isFinite(length(pos))).toBe(true);
    expect(length(pos)).toBeCloseTo(CAPTURE_DEFAULT_DISTANCE, 8);
  });
});

describe("capture rig constants", () => {
  it("keeps the default framing consistent with the rig's own defaults", () => {
    // If the offscreen rig's distance/fov/target size are retuned,
    // defaultFraming must follow or "no zoom" stops meaning "the shot
    // the automatic capture takes".
    expect(defaultFraming()).toBeCloseTo(
      framingFraction(
        CAPTURE_TARGET_WORLD_SIZE,
        CAPTURE_DEFAULT_DISTANCE,
        CAPTURE_FOV
      ),
      10
    );
    expect(defaultFraming()).toBeGreaterThan(MIN_FRAMING);
    expect(defaultFraming()).toBeLessThan(MAX_FRAMING);
  });
});

describe("restoring a saved view in the detail viewer", () => {
  it("round-trips: capture an angle, restore it, get the same camera back", () => {
    // The property that matters. previewViewFromOrbit and
    // viewerCameraPositionFor are inverses, so a file opens on exactly
    // the camera its owner pressed the button at.
    const baseline = 180;
    const target: [number, number, number] = [0, 0, 0];

    for (const offset of [
      [0, 0, 180],
      [90, 90, 90],
      [-40, 120, -60],
      [0, 0, 90], // zoomed in
      [0, 0, 320], // zoomed out
    ] as [number, number, number][]) {
      const view = previewViewFromOrbit({ offset, baselineDistance: baseline });
      const restored = viewerCameraPositionFor({
        view,
        target,
        baselineDistance: baseline,
      });

      // Same direction.
      const a = normalizeDirection(offset);
      const b = normalizeDirection(restored);
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
      expect(b[2]).toBeCloseTo(a[2], 6);

      // Same distance, up to the framing clamp.
      const original = Math.hypot(...offset);
      const clampedLow = view.framing === MAX_FRAMING;
      const clampedHigh = view.framing === MIN_FRAMING;
      if (!clampedLow && !clampedHigh) {
        expect(length(restored)).toBeCloseTo(original, 6);
      }
    }
  });

  it("leaves an untouched zoom at the viewer's own settled fit", () => {
    // Press the button without zooming and the file opens at exactly
    // the distance the viewer would have picked for itself — only the
    // angle differs.
    const baseline = 240;
    // An orbit at the baseline distance — rotated, but not zoomed. The
    // magnitude has to equal the baseline for the zoom to count as
    // untouched, which is the whole point of the assertion.
    const c = baseline / Math.SQRT2;
    const view = previewViewFromOrbit({
      offset: [0, c, c],
      baselineDistance: baseline,
    });
    expect(Math.hypot(0, c, c)).toBeCloseTo(baseline, 6);
    expect(viewerDistanceForFraming(baseline, view.framing)).toBeCloseTo(
      baseline,
      6
    );
  });

  it("moves the camera closer for a tighter saved framing", () => {
    const baseline = 200;
    expect(
      viewerDistanceForFraming(baseline, defaultFraming() * 2)
    ).toBeLessThan(baseline);
    expect(
      viewerDistanceForFraming(baseline, defaultFraming() / 2)
    ).toBeGreaterThan(baseline);
  });

  it("offsets from the controls' target, not the world origin", () => {
    const pos = viewerCameraPositionFor({
      view: { direction: [0, 0, 1], framing: defaultFraming() },
      target: [10, -5, 3],
      baselineDistance: 100,
    });
    expect(pos[0]).toBeCloseTo(10, 6);
    expect(pos[1]).toBeCloseTo(-5, 6);
    expect(pos[2]).toBeCloseTo(103, 6);
  });

  it("returns the baseline unchanged for a nonsense framing", () => {
    expect(viewerDistanceForFraming(150, 0)).toBe(150);
    expect(viewerDistanceForFraming(150, -1)).toBe(150);
    expect(viewerDistanceForFraming(0, 0.5)).toBe(0);
  });
});

describe("stageAdjustCamera", () => {
  it("disables Stage auto-fit whenever a saved view will be restored", () => {
    // Keeping fit on for even one late Refit is what wiped the saved
    // angle back to head-on (CON-27).
    expect(stageAdjustCamera(true)).toBe(false);
  });

  it("keeps Stage's 1.2 margin fit when there is no saved view", () => {
    expect(stageAdjustCamera(false)).toBe(STAGE_FIT_MARGIN);
  });
});

describe("stageFitDistance", () => {
  it("matches drei Bounds.getSize distance at Stage's margin", () => {
    // Bounds: maxSize / (2 * atan(π * fov / 360)), then × margin / aspect.
    const maxDim = 55;
    const fov = 45;
    const aspect = 4 / 3;
    const fitHeight = maxDim / (2 * Math.atan((Math.PI * fov) / 360));
    const expected = STAGE_FIT_MARGIN * Math.max(fitHeight, fitHeight / aspect);
    expect(stageFitDistance(maxDim, fov, aspect)).toBeCloseTo(expected, 10);
  });

  it("returns 0 for unusable inputs instead of NaN", () => {
    expect(stageFitDistance(0, 45, 1)).toBe(0);
    expect(stageFitDistance(10, 0, 1)).toBe(0);
    expect(stageFitDistance(10, 45, 0)).toBe(0);
  });

  it("anchors viewerCameraPositionFor on the Stage-equivalent baseline", () => {
    // A saved view at default framing must reopen at exactly the fit
    // distance — the contract ApplyInitialView relies on when Stage
    // auto-fit is off and getSize().distance would be 0.
    const view = {
      direction: [0, 0.5, 0.866] as [number, number, number],
      framing: defaultFraming(),
    };
    const baseline = stageFitDistance(40, 45, 1.333);
    const [x, y, z] = viewerCameraPositionFor({
      view,
      target: [0, 0, 0],
      baselineDistance: baseline,
    });
    expect(Math.hypot(x, y, z)).toBeCloseTo(baseline, 6);
  });
});

describe("boundsMeasurementStable", () => {
  it("rejects the first sample and unusable sizes", () => {
    expect(
      boundsMeasurementStable({
        previous: null,
        center: [0, 0, 0],
        maxDim: 10,
      })
    ).toBe(false);
    expect(
      boundsMeasurementStable({
        previous: { center: [0, 0, 0], maxDim: 10 },
        center: [0, 0, 0],
        maxDim: 0,
      })
    ).toBe(false);
  });

  it("accepts a centre/size that held within relative tolerance", () => {
    expect(
      boundsMeasurementStable({
        previous: { center: [1, 2, 3], maxDim: 100 },
        center: [1.005, 2.005, 3.005],
        maxDim: 100.005,
      })
    ).toBe(true);
  });

  it("rejects a centre that is still drifting from Stage Center", () => {
    expect(
      boundsMeasurementStable({
        previous: { center: [0, 0, 0], maxDim: 50 },
        center: [5, 0, 0],
        maxDim: 50,
      })
    ).toBe(false);
  });
});

describe("previewOrbitOffset", () => {
  it("prefers the model/Bounds centre over a panned controls target", () => {
    expect(
      previewOrbitOffset({
        camera: [10, 20, 30],
        modelCenter: [1, 2, 3],
        controlsTarget: [9, 9, 9],
      })
    ).toEqual([9, 18, 27]);
  });

  it("falls back to the controls target when centre is unknown", () => {
    expect(
      previewOrbitOffset({
        camera: [10, 20, 30],
        modelCenter: null,
        controlsTarget: [1, 2, 3],
      })
    ).toEqual([9, 18, 27]);
  });
});

describe("savedPreviewView", () => {
  const row = {
    previewDirX: 0,
    previewDirY: 1,
    previewDirZ: 1,
    previewFraming: 0.7,
  };

  it("reads a complete row and normalizes the direction", () => {
    const view = savedPreviewView(row)!;
    expect(view).not.toBeNull();
    expect(length(view.direction)).toBeCloseTo(1, 10);
    expect(view.framing).toBe(0.7);
  });

  it("returns null when any component is missing", () => {
    // A partially-written row must fall back to the viewer's own
    // framing rather than aim the camera at nothing.
    for (const key of [
      "previewDirX",
      "previewDirY",
      "previewDirZ",
      "previewFraming",
    ] as const) {
      expect(savedPreviewView({ ...row, [key]: null })).toBeNull();
    }
  });

  it("rejects a degenerate or non-finite direction", () => {
    expect(
      savedPreviewView({ ...row, previewDirX: 0, previewDirY: 0, previewDirZ: 0 })
    ).toBeNull();
    expect(savedPreviewView({ ...row, previewDirY: Number.NaN })).toBeNull();
    expect(savedPreviewView({ ...row, previewDirZ: Infinity })).toBeNull();
  });

  it("rejects a non-positive framing", () => {
    expect(savedPreviewView({ ...row, previewFraming: 0 })).toBeNull();
    expect(savedPreviewView({ ...row, previewFraming: -0.5 })).toBeNull();
    expect(savedPreviewView({ ...row, previewFraming: Number.NaN })).toBeNull();
  });
});
