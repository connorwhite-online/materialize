import { describe, it, expect } from "vitest";
import { previewLightRigQuaternion } from "../preview-lights";

describe("previewLightRigQuaternion", () => {
  it("is identity for the head-on +Z capture default", () => {
    const q = previewLightRigQuaternion([0, 0, 4.5]);
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
    expect(q.z).toBeCloseTo(0, 6);
    expect(q.w).toBeCloseTo(1, 6);
  });

  it("returns a unit quaternion for an off-axis preview angle", () => {
    const q = previewLightRigQuaternion([0.42, 0.55, 0.72]);
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    expect(length).toBeCloseTo(1, 6);
    // Must actually rotate — not identity — or Stage and capture
    // would still disagree on shading for angled previews.
    expect(Math.abs(q.w)).toBeLessThan(0.999);
  });

  it("tolerates a zero offset without throwing", () => {
    const q = previewLightRigQuaternion([0, 0, 0]);
    expect(q.w).toBeCloseTo(1, 6);
  });
});
