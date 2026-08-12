import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PromptImage } from "@/lib/cad/types";

// --- @/lib/db/schema: minimal column-reference stubs (same pattern as
// persist.test.ts — the mocked db below never inspects them). ---
vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    id: "id",
    prompt: "prompt",
    parentGenerationId: "parent_generation_id",
    rating: "rating",
    feedbackNote: "feedback_note",
    referenceImages: "reference_images",
  },
}));

// --- @/lib/db: selects resolve from a FIFO queue (one entry per select
// call); updates record their set() payloads. ---
const mockUpdateSet = vi.fn();
let selectQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
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

// --- @/lib/storage: in-memory object store. ---
const stored = new Map<string, Uint8Array>();
const putObject = vi.fn(async (key: string, bytes: Uint8Array) => {
  stored.set(key, bytes);
});
const getObjectBytes = vi.fn(async (key: string) => {
  const bytes = stored.get(key);
  if (!bytes) throw new Error(`no object: ${key}`);
  return bytes;
});
vi.mock("@/lib/storage", () => ({
  putObject: (...a: Parameters<typeof putObject>) => putObject(...a),
  getObjectBytes: (...a: Parameters<typeof getObjectBytes>) =>
    getObjectBytes(...a),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

let nanoidCounter = 0;
vi.mock("nanoid", () => ({ nanoid: () => `nid-${++nanoidCounter}` }));

import {
  resolveReferenceImages,
  buildThreadHistory,
  appendConceptReference,
} from "@/lib/cad/reference-images";
import { CONCEPT_THREAD_REF_LABEL } from "@/lib/cad/concept";

const img = (data: string): PromptImage => ({ data, mediaType: "image/png" });

describe("resolveReferenceImages", () => {
  beforeEach(() => {
    selectQueue = [];
    stored.clear();
    nanoidCounter = 0;
    mockUpdateSet.mockClear();
    putObject.mockClear();
    getObjectBytes.mockClear();
  });

  it("fresh build: uploads each image under cad-refs/ and persists keys on the row", async () => {
    const images = await resolveReferenceImages({
      generationId: "gen-1",
      userId: "user-1",
      images: [img("QUJD")],
    });

    expect(images).toHaveLength(1);
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject.mock.calls[0][0]).toBe("cad-refs/user-1/nid-1.png");
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      referenceImages: [
        { key: "cad-refs/user-1/nid-1.png", mediaType: "image/png" },
      ],
    });
  });

  it("revision: inherits the parent's stored refs and returns their bytes", async () => {
    stored.set("cad-refs/user-1/old.png", new Uint8Array([1, 2, 3]));
    selectQueue.push([
      {
        referenceImages: [
          { key: "cad-refs/user-1/old.png", mediaType: "image/png" },
        ],
      },
    ]);

    const images = await resolveReferenceImages({
      generationId: "gen-2",
      userId: "user-1",
      parentGenerationId: "gen-1",
    });

    expect(images).toHaveLength(1);
    expect(images?.[0].mediaType).toBe("image/png");
    expect(images?.[0].data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    // The inherited key is re-persisted on the new row (shared key).
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({
      referenceImages: [
        { key: "cad-refs/user-1/old.png", mediaType: "image/png" },
      ],
    });
  });

  it("revision with new images: new first, inherited after, capped at 4", async () => {
    for (let i = 0; i < 4; i++) {
      stored.set(`cad-refs/user-1/old-${i}.png`, new Uint8Array([i]));
    }
    selectQueue.push([
      {
        referenceImages: [0, 1, 2, 3].map((i) => ({
          key: `cad-refs/user-1/old-${i}.png`,
          mediaType: "image/png",
        })),
      },
    ]);

    const images = await resolveReferenceImages({
      generationId: "gen-3",
      userId: "user-1",
      parentGenerationId: "gen-1",
      images: [img("QUJD"), img("REVG")],
    });

    expect(images).toHaveLength(4);
    // New in-memory images lead; only 2 inherited slots remain.
    expect(images?.[0].data).toBe("QUJD");
    expect(images?.[1].data).toBe("REVG");
    const persisted = mockUpdateSet.mock.calls[0][0] as {
      referenceImages: { key: string }[];
    };
    expect(persisted.referenceImages.map((r) => r.key)).toEqual([
      "cad-refs/user-1/nid-1.png",
      "cad-refs/user-1/nid-2.png",
      "cad-refs/user-1/old-0.png",
      "cad-refs/user-1/old-1.png",
    ]);
  });

  it("an upload failure keeps the image for this run but skips persistence", async () => {
    putObject.mockRejectedValueOnce(new Error("r2 down"));
    const images = await resolveReferenceImages({
      generationId: "gen-4",
      userId: "user-1",
      images: [img("QUJD")],
    });
    expect(images).toHaveLength(1);
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("a missing inherited object is skipped, not fatal", async () => {
    selectQueue.push([
      {
        referenceImages: [
          { key: "cad-refs/user-1/gone.png", mediaType: "image/png" },
        ],
      },
    ]);
    const images = await resolveReferenceImages({
      generationId: "gen-5",
      userId: "user-1",
      parentGenerationId: "gen-1",
    });
    expect(images).toBeUndefined();
  });
});

describe("buildThreadHistory", () => {
  beforeEach(() => {
    selectQueue = [];
  });

  it("walks the parent chain and returns turns oldest-first", async () => {
    // Walk starts at the immediate parent (rev-2) and follows parent links.
    selectQueue.push(
      [
        {
          prompt: "add a slot",
          parentGenerationId: "rev-1",
          rating: "bad",
          feedbackNote: "too small",
        },
      ],
      [
        {
          prompt: "a phone stand",
          parentGenerationId: null,
          rating: "good",
          feedbackNote: null,
        },
      ]
    );

    const history = await buildThreadHistory("rev-2");
    expect(history).toEqual([
      { prompt: "a phone stand", rating: "good", note: null },
      // Immediate parent: rating/note stripped — priorFeedback already
      // carries them into the revise prompt.
      { prompt: "add a slot" },
    ]);
  });

  it("stops on a missing row", async () => {
    selectQueue.push([]);
    expect(await buildThreadHistory("gone")).toEqual([]);
  });

  it("truncates long prompts", async () => {
    selectQueue.push([
      {
        prompt: "x".repeat(500),
        parentGenerationId: null,
        rating: null,
        feedbackNote: null,
      },
    ]);
    const history = await buildThreadHistory("rev-1");
    expect(history[0].prompt.length).toBeLessThanOrEqual(241);
    expect(history[0].prompt.endsWith("…")).toBe(true);
  });
});

describe("appendConceptReference", () => {
  beforeEach(() => {
    selectQueue = [];
    stored.clear();
    nanoidCounter = 0;
    mockUpdateSet.mockClear();
    putObject.mockClear();
  });

  it("appends the concept after user refs with its thread label", async () => {
    selectQueue.push([
      {
        referenceImages: [
          { key: "cad-refs/u/user.png", mediaType: "image/png" },
        ],
      },
    ]);
    await appendConceptReference({
      generationId: "gen-1",
      userId: "u",
      png: "Q09OQ0VQVA==",
    });
    const persisted = mockUpdateSet.mock.calls[0][0] as {
      referenceImages: { key: string; label?: string }[];
    };
    expect(persisted.referenceImages).toHaveLength(2);
    expect(persisted.referenceImages[0].key).toBe("cad-refs/u/user.png");
    expect(persisted.referenceImages[1].label).toBe(CONCEPT_THREAD_REF_LABEL);
  });

  it("UPSERTS: an existing concept entry is replaced, never duplicated", async () => {
    selectQueue.push([
      {
        referenceImages: [
          { key: "cad-refs/u/user.png", mediaType: "image/png" },
          {
            key: "cad-refs/u/old-concept.png",
            mediaType: "image/png",
            label: CONCEPT_THREAD_REF_LABEL,
          },
        ],
      },
    ]);
    await appendConceptReference({
      generationId: "gen-1",
      userId: "u",
      png: "TkVX",
    });
    const persisted = mockUpdateSet.mock.calls[0][0] as {
      referenceImages: { key: string; label?: string }[];
    };
    expect(persisted.referenceImages).toHaveLength(2);
    expect(
      persisted.referenceImages.filter(
        (r) => r.label === CONCEPT_THREAD_REF_LABEL
      )
    ).toHaveLength(1);
    expect(persisted.referenceImages[1].key).not.toBe(
      "cad-refs/u/old-concept.png"
    );
  });

  it("skips when user refs already fill every slot", async () => {
    selectQueue.push([
      {
        referenceImages: [0, 1, 2, 3].map((i) => ({
          key: `cad-refs/u/${i}.png`,
          mediaType: "image/png",
        })),
      },
    ]);
    await appendConceptReference({
      generationId: "gen-1",
      userId: "u",
      png: "TkVX",
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});
