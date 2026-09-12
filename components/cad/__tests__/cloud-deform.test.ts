import { describe, expect, it } from "vitest";
import {
  BLOB_ACTIVE_SPEED,
  BLOB_IDLE_SPEED,
  FORMED_ACTIVE_AMP,
  FORMED_ACTIVE_SPEED,
  FORMED_IDLE_AMP,
  FORMED_IDLE_SPEED,
  deformTarget,
} from "../cloud-deform";

/** The blob's own amps, as PointCloudScene passes them. */
const BLOB = { idleAmp: 0.18, activeAmp: 0.32 };
/** A revision's source-surface cloud: already gentler than the blob. */
const SURFACE = { idleAmp: 0.05, activeAmp: 0.14 };

describe("deformTarget", () => {
  it("leaves the abstract blob churning at full amplitude and rate", () => {
    expect(deformTarget({ formed: false, active: true, ...BLOB })).toEqual({
      amp: BLOB.activeAmp,
      speed: BLOB_ACTIVE_SPEED,
    });
    expect(deformTarget({ formed: false, active: false, ...BLOB })).toEqual({
      amp: BLOB.idleAmp,
      speed: BLOB_IDLE_SPEED,
    });
  });

  it("slows the rate once the cloud is showing geometry, in both states", () => {
    const workingBlob = deformTarget({ formed: false, active: true, ...BLOB });
    const workingShape = deformTarget({ formed: true, active: true, ...BLOB });
    const restingBlob = deformTarget({ formed: false, active: false, ...BLOB });
    const restingShape = deformTarget({ formed: true, active: false, ...BLOB });

    expect(workingShape.speed).toBeLessThan(workingBlob.speed);
    expect(restingShape.speed).toBeLessThan(restingBlob.speed);
  });

  it("holds a working shape to no more churn than a blob at rest", () => {
    // The anchor the formed rate is set by — a shape at its busiest must not
    // move faster than the blob does with nothing to do.
    const workingShape = deformTarget({ formed: true, active: true, ...BLOB });
    expect(workingShape.speed).toBeLessThanOrEqual(BLOB_IDLE_SPEED);
  });

  it("caps a formed shape's amplitude", () => {
    expect(deformTarget({ formed: true, active: true, ...BLOB }).amp).toBe(
      FORMED_ACTIVE_AMP
    );
    expect(deformTarget({ formed: true, active: false, ...BLOB }).amp).toBe(
      FORMED_IDLE_AMP
    );
  });

  it("lets a cloud gentler than the ceiling keep its own amplitude", () => {
    // A ceiling, not a replacement: a surface cloud must not be made MORE
    // agitated by forming.
    expect(deformTarget({ formed: true, active: false, ...SURFACE }).amp).toBe(
      SURFACE.idleAmp
    );
    expect(
      deformTarget({ formed: true, active: true, ...SURFACE }).amp
    ).toBeLessThanOrEqual(SURFACE.activeAmp);
  });

  it("cuts how fast the surface actually moves several-fold", () => {
    // Perceived agitation is roughly amplitude x rate; the request was to slow
    // the deformation on the geometry, and neither half alone does much.
    const blob = deformTarget({ formed: false, active: true, ...BLOB });
    const shape = deformTarget({ formed: true, active: true, ...BLOB });
    const ratio = (blob.amp * blob.speed) / (shape.amp * shape.speed);
    expect(ratio).toBeGreaterThan(4);
  });

  it("never returns a rate or amplitude that stops the cloud dead", () => {
    for (const formed of [true, false]) {
      for (const active of [true, false]) {
        const t = deformTarget({ formed, active, ...BLOB });
        expect(t.speed).toBeGreaterThan(0);
        expect(t.amp).toBeGreaterThan(0);
      }
    }
    expect(FORMED_IDLE_SPEED).toBeGreaterThan(0);
    expect(FORMED_ACTIVE_SPEED).toBeGreaterThan(0);
  });
});
