import { describe, it, expect } from "vitest";

import type { CadFeature } from "@/lib/cad/types";
import {
  iconKindForOp,
  timelineEntries,
  featureForFaceId,
  featureIdsForFaceIds,
} from "@/components/cad/feature-timeline";

/**
 * MTR-224 — pure ordering/icon-mapping/reverse-lookup helpers for the
 * construction-timeline strip. Feature order is never re-sorted here: the
 * sidecar's emission order IS construction order.
 */

function feature(overrides: Partial<CadFeature>): CadFeature {
  return {
    id: "f-0",
    op: "extrude",
    label: "Extrude",
    params: {},
    faceIds: [],
    ...overrides,
  };
}

describe("iconKindForOp", () => {
  it("maps every known B-rep op to its own icon kind", () => {
    expect(iconKindForOp("extrude")).toBe("extrude");
    expect(iconKindForOp("revolve")).toBe("revolve");
    expect(iconKindForOp("boolean")).toBe("boolean");
    expect(iconKindForOp("fillet")).toBe("fillet");
    expect(iconKindForOp("chamfer")).toBe("chamfer");
    expect(iconKindForOp("shell")).toBe("shell");
    expect(iconKindForOp("loft")).toBe("loft");
    expect(iconKindForOp("hole")).toBe("hole");
  });

  it("collapses the sidecar's other op, and any unrecognized op, into generic", () => {
    expect(iconKindForOp("other")).toBe("generic");
    expect(iconKindForOp("some-future-op")).toBe("generic");
  });
});

describe("timelineEntries", () => {
  it("preserves input order verbatim and assigns 1-based steps", () => {
    const features = [
      feature({ id: "a", op: "extrude", label: "Base" }),
      feature({ id: "b", op: "fillet", label: "Round edges" }),
      feature({ id: "c", op: "hole", label: "Mount hole" }),
    ];
    const entries = timelineEntries(features);
    expect(entries.map((e) => e.feature.id)).toEqual(["a", "b", "c"]);
    expect(entries.map((e) => e.step)).toEqual([1, 2, 3]);
    expect(entries.map((e) => e.iconKind)).toEqual([
      "extrude",
      "fillet",
      "hole",
    ]);
  });

  it("builds an accessible name with step number, op noun, and label", () => {
    const [entry] = timelineEntries([
      feature({ id: "a", op: "fillet", label: "Round edges r=2.4" }),
    ]);
    expect(entry.accessibleName).toBe("Step 1: Fillet — Round edges r=2.4");
  });

  it("omits the label half when it just repeats the op noun", () => {
    const [entry] = timelineEntries([
      feature({ id: "a", op: "fillet", label: "Fillet" }),
    ]);
    expect(entry.accessibleName).toBe("Step 1: Fillet");

    // Case-insensitive + surrounding whitespace both collapse the same way.
    const [entry2] = timelineEntries([
      feature({ id: "b", op: "fillet", label: "  fillet  " }),
    ]);
    expect(entry2.accessibleName).toBe("Step 1: Fillet");
  });

  it("falls back to the generic 'Operation' noun for unrecognized ops", () => {
    const [entry] = timelineEntries([
      feature({ id: "a", op: "other", label: "Custom step" }),
    ]);
    expect(entry.accessibleName).toBe("Step 1: Operation — Custom step");
  });
});

describe("featureForFaceId", () => {
  const features = [
    feature({ id: "a", op: "extrude", faceIds: [1, 2, 3] }),
    feature({ id: "b", op: "fillet", faceIds: [3, 4] }),
  ];

  it("finds the feature owning a face id", () => {
    expect(featureForFaceId(features, 1)?.id).toBe("a");
  });

  it("resolves a shared face id to the LAST (most recent) owning feature", () => {
    expect(featureForFaceId(features, 3)?.id).toBe("b");
  });

  it("returns null when no feature claims the face id", () => {
    expect(featureForFaceId(features, 999)).toBeNull();
  });
});

describe("featureIdsForFaceIds", () => {
  const features = [
    feature({ id: "a", op: "extrude", faceIds: [1, 2, 3] }),
    feature({ id: "b", op: "fillet", faceIds: [3, 4] }),
    feature({ id: "c", op: "chamfer", faceIds: [] }),
  ];

  it("collects the owning feature ids for a set of face ids", () => {
    const ids = featureIdsForFaceIds(features, [1, 4]);
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("dedupes when multiple face ids resolve to the same feature", () => {
    const ids = featureIdsForFaceIds(features, [1, 2]);
    expect(ids).toEqual(new Set(["a"]));
  });

  it("ignores unowned face ids and returns an empty set for no matches", () => {
    expect(featureIdsForFaceIds(features, [999])).toEqual(new Set());
    expect(featureIdsForFaceIds(features, [])).toEqual(new Set());
  });
});
