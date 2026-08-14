import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors reference-images.test.ts — the mocked db never inspects these.
vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    id: "id",
    geometryRefs: "geometry_refs",
  },
}));

const mockUpdateSet = vi.fn();
let selectQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({ limit: async () => selectQueue.shift() ?? [] }),
      }),
    })),
    update: vi.fn(() => ({
      set: (vals: unknown) => {
        mockUpdateSet(vals);
        return { where: () => Promise.resolve() };
      },
    })),
  },
}));

const stored = new Map<string, Uint8Array>();
vi.mock("@/lib/storage", () => ({
  getObjectBytes: async (key: string) => {
    const bytes = stored.get(key);
    if (!bytes) throw new Error(`no object: ${key}`);
    return bytes;
  },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

let nanoidCounter = 0;
vi.mock("nanoid", () => ({ nanoid: () => `nid-${++nanoidCounter}` }));

import {
  buildGeometryKey,
  loadGeometryForRun,
  resolveGeometryRefs,
  sanitizeAttachedGeometry,
  type StoredGeometryRef,
} from "@/lib/cad/geometry-refs";
import {
  CAPTURE_TIERS,
  MAX_GEOMETRY_REFS,
  resolveCaptureTier,
} from "@/lib/cad/scan-tiers";

const USER = "user_abc";
const OTHER = "user_xyz";
const key = (u: string, n = 1) => `cad-geo/${u}/scan${n}.ply`;

beforeEach(() => {
  selectQueue = [];
  stored.clear();
  mockUpdateSet.mockClear();
  nanoidCounter = 0;
});

describe("sanitizeAttachedGeometry", () => {
  it("accepts a well-formed attachment from the caller's own prefix", () => {
    expect(
      sanitizeAttachedGeometry(
        [{ key: key(USER), fileType: "PLY", label: "mug.ply" }],
        USER
      )
    ).toEqual([{ key: key(USER), fileType: "ply", label: "mug.ply" }]);
  });

  it("drops a key belonging to another user", () => {
    // The security property: the presign route stamps the owner into the path,
    // so a key outside the caller's prefix was never issued to them.
    expect(
      sanitizeAttachedGeometry([{ key: key(OTHER), fileType: "ply" }], USER)
    ).toEqual([]);
  });

  it("drops a key that tries to climb out of the prefix", () => {
    expect(
      sanitizeAttachedGeometry(
        [{ key: `cad-geo/${USER}/../${OTHER}/x.ply`, fileType: "ply" }],
        USER
      )
    ).toEqual([]);
  });

  it("drops unsupported formats and non-objects", () => {
    expect(
      sanitizeAttachedGeometry(
        [
          { key: key(USER, 1), fileType: "step" },
          { key: key(USER, 2), fileType: "exe" },
          null,
          "nope",
        ],
        USER
      )
    ).toEqual([]);
  });

  it("caps the number of attachments", () => {
    const many = Array.from({ length: MAX_GEOMETRY_REFS + 3 }, (_, i) => ({
      key: key(USER, i),
      fileType: "ply",
    }));
    expect(sanitizeAttachedGeometry(many, USER)).toHaveLength(
      MAX_GEOMETRY_REFS
    );
  });

  it("returns nothing for a non-array", () => {
    expect(sanitizeAttachedGeometry({ key: key(USER) }, USER)).toEqual([]);
  });
});

describe("resolveGeometryRefs", () => {
  it("stamps the capture tier's clearance and proxy level onto the ref", async () => {
    const refs = await resolveGeometryRefs({
      generationId: "gen1",
      userId: USER,
      geometry: [{ key: key(USER), fileType: "ply", captureTier: "phone_lidar" }],
    });
    const tier = CAPTURE_TIERS.phone_lidar;
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      key: key(USER),
      name: "scan",
      clearanceMm: tier.clearanceMm,
      proxyLevel: tier.proxyLevel,
      captureTier: "phone_lidar",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ geometryRefs: refs })
    );
  });

  it("inherits the parent's geometry so a revision still knows the object", async () => {
    const inherited: StoredGeometryRef = {
      key: key(USER, 9),
      name: "scan",
      fileType: "ply",
      clearanceMm: 3,
      proxyLevel: "hull",
      captureTier: "phone_lidar",
    };
    selectQueue.push([{ geometryRefs: [inherited] }]);
    const refs = await resolveGeometryRefs({
      generationId: "gen2",
      userId: USER,
      parentGenerationId: "gen1",
      geometry: [],
    });
    expect(refs.map((r) => r.key)).toEqual([inherited.key]);
  });

  it("does not duplicate a ref the parent already carries", async () => {
    const shared: StoredGeometryRef = {
      key: key(USER),
      name: "scan",
      fileType: "ply",
      clearanceMm: 3,
      proxyLevel: "hull",
    };
    selectQueue.push([{ geometryRefs: [shared] }]);
    const refs = await resolveGeometryRefs({
      generationId: "gen2",
      userId: USER,
      parentGenerationId: "gen1",
      geometry: [{ key: shared.key, fileType: "ply" }],
    });
    expect(refs).toHaveLength(1);
  });

  it("assigns binding names that are valid python identifiers and unique", async () => {
    const refs = await resolveGeometryRefs({
      generationId: "gen1",
      userId: USER,
      geometry: [
        { key: key(USER, 1), fileType: "ply" },
        { key: key(USER, 2), fileType: "obj" },
      ],
    });
    const names = refs.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    // Generated code refers to the first one by name, so it must stay "scan".
    expect(names[0]).toBe("scan");
  });

  it("survives a parent lookup failure with this turn's own geometry", async () => {
    selectQueue = []; // select resolves []; parent simply has none
    const refs = await resolveGeometryRefs({
      generationId: "gen2",
      userId: USER,
      parentGenerationId: "missing",
      geometry: [{ key: key(USER), fileType: "ply" }],
    });
    expect(refs).toHaveLength(1);
  });
});

describe("loadGeometryForRun", () => {
  const ref = (k: string): StoredGeometryRef => ({
    key: k,
    name: "scan",
    fileType: "ply",
    clearanceMm: 3,
    proxyLevel: "hull",
    captureTier: "phone_lidar",
  });

  it("base64s the stored bytes into the sidecar payload", async () => {
    stored.set(key(USER), new Uint8Array([1, 2, 3, 4]));
    const meshes = await loadGeometryForRun([ref(key(USER))]);
    expect(meshes.scan).toEqual({
      b64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      fileType: "ply",
      proxyLevel: "hull",
      clearanceMm: 3,
    });
  });

  it("drops an unreadable object instead of failing the generation", async () => {
    // A swept or expired object must not turn a whole thread into an error.
    await expect(loadGeometryForRun([ref(key(USER))])).resolves.toEqual({});
  });
});

describe("capture tiers", () => {
  it("falls back to the supported tier for anything unknown or not enabled", () => {
    // An unsupported tier means "we cannot vouch for that accuracy", so the
    // safe reading is the loosest one — never a rejection.
    expect(resolveCaptureTier("structured_light").id).toBe("phone_lidar");
    expect(resolveCaptureTier("nonsense").id).toBe("phone_lidar");
    expect(resolveCaptureTier(null).id).toBe("phone_lidar");
  });

  it("never promises a tight fit at phone-lidar accuracy", () => {
    const tier = CAPTURE_TIERS.phone_lidar;
    expect(tier.tightFits).toBe(false);
    // Clearance must stay well clear of the tolerances a snap fit needs.
    expect(tier.clearanceMm).toBeGreaterThanOrEqual(1);
    expect(tier.archetypes).not.toContain("snap fit");
  });
});

describe("buildGeometryKey", () => {
  it("puts the owner in the path and never the user's filename", () => {
    const k = buildGeometryKey(USER, "ply");
    expect(k.startsWith(`cad-geo/${USER}/`)).toBe(true);
    expect(k.endsWith(".ply")).toBe(true);
  });
});
