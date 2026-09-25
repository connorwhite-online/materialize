import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  PARTS,
  sampleFrame,
  type Geometry,
  type PartId,
} from "../choreography";
import {
  INTRO_SEQUENCE,
  LANDING_MATERIALS,
  RESTING_WORD,
  wrapIndex,
} from "../landing-materials";
import { progressFor } from "../enclosure-stage";

// Part centres measured off the source GLB (mm → m).
const mm = (x: number, y: number, z: number) =>
  new Vector3(x, y, z).multiplyScalar(0.001);
const GEO: Geometry = {
  centers: {
    rear: mm(0.45, 2.45, 2),
    front: mm(0.45, 14.2, 1.95),
    carrier: mm(0.45, 3.1, 5.9),
    ffc: mm(-8.2, 2.65, 9.55),
    battery: mm(-0.4, 6.4, 9),
    main: mm(1.4, 5.5, -24.55),
    pwr: mm(-1.55, 5.85, 39.4),
    speaker: mm(-8, 10.35, -12.4),
    lra: mm(-10.5, 10.6, -30.5),
    camera: mm(0, 15.55, -24.3),
  } as Record<PartId, Vector3>,
  modelCenter: mm(0.45, 10.15, 2),
};
const DESKTOP = { w: 6.8, h: 3.78 };
const PHONE = { w: 1.74, h: 3.78 };
const internals = PARTS.filter((p) => !p.shell);

describe.each([
  ["desktop", DESKTOP],
  ["phone", PHONE],
])("landing choreography (%s)", (_, view) => {
  it("opens on the assembled shells alone", () => {
    const f = sampleFrame(0, GEO, view);
    expect(f.poses.front.opacity).toBe(1);
    expect(f.poses.rear.opacity).toBe(1);
    for (const p of internals) expect(f.poses[p.id].opacity).toBe(0);
    expect(f.hero).toBe(1);
    // Assembled: the two shells sit within a device depth of each other.
    const gap = f.poses.front.position.distanceTo(f.poses.rear.position);
    expect(gap / f.poses.front.scale).toBeLessThan(0.02);
  });

  it("splits the shells left/right with the file labels up", () => {
    const f = sampleFrame(1, GEO, view);
    expect(f.poses.front.position.x).toBeLessThan(0);
    expect(f.poses.rear.position.x).toBeGreaterThan(0);
    expect(f.fileLabels).toBe(1);
    expect(f.bomLabels).toBe(0);
    expect(f.hero).toBe(0);
    for (const p of internals) expect(f.poses[p.id].opacity).toBe(0);
  });

  it("explodes every part left → right in stack order, fully visible", () => {
    const f = sampleFrame(2, GEO, view);
    for (const p of PARTS) expect(f.poses[p.id].opacity).toBe(1);
    const xs = [...PARTS]
      .sort((a, b) => a.slot - b.slot)
      .filter((p, i, arr) => i === 0 || p.slot !== arr[i - 1].slot)
      .map((p) => f.poses[p.id].position.x);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(f.bomLabels).toBe(1);
    expect(f.fileLabels).toBe(0);
  });

  it("keeps the exploded view inside the viewport", () => {
    const f = sampleFrame(2, GEO, view);
    for (const p of PARTS) {
      expect(Math.abs(f.poses[p.id].position.x)).toBeLessThan(view.w / 2);
    }
    expect(f.labelRows.top + f.labelRows.lane).toBeLessThan(view.h / 2);
    expect(f.labelRows.bottom - f.labelRows.lane).toBeGreaterThan(-view.h / 2);
  });

  it("reassembles and zooms past the viewport behind the FAQ", () => {
    const f = sampleFrame(3, GEO, view);
    for (const p of internals) expect(f.poses[p.id].opacity).toBe(0);
    expect(f.poses.front.scale * 0.121).toBeGreaterThan(view.h);
  });

  it("clamps outside 0…3 and never produces NaN mid-transition", () => {
    expect(sampleFrame(-2, GEO, view).poses.front.position).toEqual(
      sampleFrame(0, GEO, view).poses.front.position,
    );
    for (let p = 0; p <= 3; p += 0.125) {
      const f = sampleFrame(p, GEO, view);
      for (const part of PARTS) {
        const pose = f.poses[part.id];
        expect(Number.isFinite(pose.position.length())).toBe(true);
        expect(Number.isFinite(pose.quaternion.w)).toBe(true);
      }
    }
  });
});

describe("landing intro", () => {
  it("visits every family once, then rests on 'anything' at the first", () => {
    const mats = INTRO_SEQUENCE.slice(0, -1).map((s) => s.material);
    expect(mats).toEqual(LANDING_MATERIALS.map((_, i) => i));
    expect(INTRO_SEQUENCE.at(-1)).toEqual({ material: 0, word: RESTING_WORD });
  });

  it("wraps the carousel both ways", () => {
    expect(wrapIndex(-1)).toBe(LANDING_MATERIALS.length - 1);
    expect(wrapIndex(LANDING_MATERIALS.length)).toBe(0);
  });
});

describe("progressFor", () => {
  const tops = [0, 800, 1600, 2400];
  it("is linear between section tops and clamps at the last", () => {
    expect(progressFor(0, tops)).toBe(0);
    expect(progressFor(400, tops)).toBe(0.5);
    expect(progressFor(1600, tops)).toBe(2);
    expect(progressFor(9999, tops)).toBe(3);
  });
});

describe("orientation continuity", () => {
  it("keeps the device's long axis pointing the same way in every pose", () => {
    const down = new Vector3(0, 0, 1); // model long axis
    for (const p of [0, 1, 2, 3]) {
      const q = sampleFrame(p, GEO, DESKTOP).poses.main.quaternion;
      // Long axis stays in the lower hemisphere — no 180° roll between sections.
      expect(down.clone().applyQuaternion(q).y).toBeLessThan(0);
    }
  });
});
