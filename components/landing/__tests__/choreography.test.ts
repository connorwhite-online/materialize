import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  PARTS,
  sampleFrame,
  orbitFrame,
  mixFrames,
  type Geometry,
  type PartId,
} from "../choreography";
import { LANDING_MATERIALS, wrapIndex } from "../landing-materials";
import { zoomFor } from "../enclosure-stage";

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
    expect(f.poses.front.position.x).toBeLessThan(f.poses.rear.position.x);
    expect(f.fileLabels).toBe(1);
    expect(f.bomLabels).toBe(0);
    expect(f.hero).toBe(0);
    for (const p of internals) expect(f.poses[p.id].opacity).toBe(0);
  });

  it("explodes every part in stack order, front shell on the left, fully visible", () => {
    const f = sampleFrame(2, GEO, view);
    for (const p of PARTS) expect(f.poses[p.id].opacity).toBe(1);
    const xs = [...PARTS]
      .sort((a, b) => a.slot - b.slot)
      .filter((p, i, arr) => i === 0 || p.slot !== arr[i - 1].slot)
      .map((p) => f.poses[p.id].position.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]);
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

  it("keeps each shell on its own side from the split into the explode", () => {
    for (const p of [1, 2]) {
      const f = sampleFrame(p, GEO, view);
      expect(f.poses.front.position.x).toBeLessThan(f.poses.rear.position.x);
    }
  });

  it("closes up for the FAQ: tipped back onto the table, only the camera left inside", () => {
    const f = sampleFrame(3, GEO, view);
    for (const p of internals) {
      expect(f.poses[p.id].opacity, p.id).toBe(p.id === "camera" ? 1 : 0);
    }
    // Tipped back: the face tilts up and still toward the viewer.
    const face = new Vector3(0, 1, 0).applyQuaternion(f.poses.front.quaternion);
    expect(face.y).toBeGreaterThan(0.5);
    expect(face.z).toBeGreaterThan(0.3);
    // One natural hinge from the hero, not a corkscrew: well under a
    // right angle of total rotation between the two poses.
    const hero = sampleFrame(0, GEO, view).poses.front.quaternion;
    expect(hero.angleTo(f.poses.front.quaternion)).toBeLessThan(Math.PI * 0.45);
  });

  it("holds internals until the shells close when crossfading to the FAQ", () => {
    const a = sampleFrame(2, GEO, view);
    const b = sampleFrame(3, GEO, view);
    expect(mixFrames(a, b, 0.5).poses.main.opacity).toBeGreaterThan(0.9);
    expect(mixFrames(a, b, 1).poses.main.opacity).toBe(0);
    expect(mixFrames(a, b, 1).poses.camera.opacity).toBe(1);
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

describe("material carousel", () => {
  it("wraps the carousel both ways", () => {
    expect(wrapIndex(-1)).toBe(LANDING_MATERIALS.length - 1);
    expect(wrapIndex(LANDING_MATERIALS.length)).toBe(0);
  });
});

describe("zoomFor", () => {
  it("rises from 0 at the top to 1 most of a screen down, clamped", () => {
    expect(zoomFor(0, 800)).toBe(0);
    expect(zoomFor(320, 800)).toBe(0.5);
    expect(zoomFor(5000, 800)).toBe(1);
    expect(zoomFor(-40, 800)).toBe(0);
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

describe("BOM leaders", () => {
  it("never cross between parts that share a column", () => {
    const f = sampleFrame(2, GEO, DESKTOP);
    const labelled = PARTS.filter((p) => p.bom);
    for (const a of labelled) {
      for (const b of labelled) {
        if (a === b || a.slot !== b.slot) continue;
        // Within a column, the higher part labels up and the lower down —
        // otherwise one leader runs through the other part.
        const [hi, lo] =
          f.poses[a.id].position.y > f.poses[b.id].position.y ? [a, b] : [b, a];
        expect(hi.bom!.side, `${hi.id} over ${lo.id}`).toBe("top");
        expect(lo.bom!.side, `${lo.id} under ${hi.id}`).toBe("bottom");
      }
    }
  });
});

describe("drag orbit", () => {
  it("turns the scene rigidly while label anchors hold still", () => {
    const f = sampleFrame(2, GEO, DESKTOP);
    const o = orbitFrame(f, 0.4);
    const pivot = f.poses.front.position
      .clone()
      .add(f.poses.rear.position)
      .multiplyScalar(0.5);
    for (const p of PARTS) {
      // Same distance from the pivot, different place.
      expect(o.poses[p.id].position.distanceTo(pivot)).toBeCloseTo(
        f.poses[p.id].position.distanceTo(pivot),
        6,
      );
      expect(o.anchors![p.id].equals(f.poses[p.id].position)).toBe(true);
    }
    expect(o.poses.front.position.equals(f.poses.front.position)).toBe(false);
  });

  it("is a no-op at zero yaw", () => {
    const f = sampleFrame(1, GEO, DESKTOP);
    const o = orbitFrame(f, 0);
    for (const p of PARTS) {
      expect(
        o.poses[p.id].position.distanceTo(f.poses[p.id].position),
      ).toBeLessThan(1e-9);
    }
  });
});

describe("desktop BOM clears the nav", () => {
  it("keeps the top label lane below the top bar", () => {
    const f = sampleFrame(2, GEO, DESKTOP);
    // Top bar is ~80px of a 900px viewport ≈ 9% of the height.
    expect(f.labelRows.top + f.labelRows.lane).toBeLessThan(
      DESKTOP.h * (0.5 - 0.09),
    );
  });
});
