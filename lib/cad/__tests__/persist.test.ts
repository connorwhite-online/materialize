import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessResult } from "@/lib/cad/harness";
import type { CadPart } from "@/lib/cad/types";

// --- @/lib/db/schema: minimal column-reference stubs (drizzle-orm's real
// eq()/and() just wrap these into expression objects; identity doesn't
// matter to our mocked db below). ---
vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    id: "id",
    userId: "user_id",
    threadId: "thread_id",
    parentGenerationId: "parent_generation_id",
    title: "title",
  },
  cadThreads: { id: "id", userId: "user_id" },
  files: { id: "id", slug: "slug", userId: "user_id" },
  fileAssets: { id: "id", stepStorageKey: "step_storage_key" },
  projects: { id: "id", slug: "slug" },
  projectFiles: { projectId: "project_id", fileId: "file_id", position: "position" },
}));

// --- @/lib/cad/title: deterministic thread title (root turns only). ---
vi.mock("@/lib/cad/title", () => ({
  generateThreadTitle: vi.fn(async () => "Widget Bracket"),
}));

// --- @/lib/db: track insert/select/update calls; the first insert() call
// in persistAssembly is always the Project insert (.returning()), the
// second is the projectFiles link insert (no .returning()). Selects
// resolve from `selectQueue` when seeded (thread-linkage tests), falling
// back to a synthetic file-id row otherwise. ---
const mockUpdateSet = vi.fn();
const mockInsertValues = vi.fn();
const mockSelectWhere = vi.fn();

let insertCallCount = 0;
let selectCallCount = 0;
let selectQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: (vals: unknown) => {
        mockUpdateSet(vals);
        return { where: () => Promise.resolve() };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: (vals: unknown) => {
        insertCallCount++;
        mockInsertValues(table, vals);
        const isFirstInsert = insertCallCount === 1;
        const p = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<Array<{ slug: string; id: string }>>;
        };
        p.returning = async () =>
          isFirstInsert ? [{ slug: "assembly-slug", id: "project-1" }] : [];
        return p;
      },
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          selectCallCount++;
          mockSelectWhere();
          const queued = selectQueue.shift();
          const rows = queued ?? [{ id: `file-id-${selectCallCount}` }];
          return Object.assign([...rows], { limit: () => rows });
        },
      }),
    })),
  },
}));

// --- @/lib/storage: putObject is the guard under test. ---
const putObject = vi.fn(async (..._args: unknown[]) => undefined);
const generateDownloadUrl = vi.fn(
  async (..._args: unknown[]) => "https://example.test/render.png"
);
vi.mock("@/lib/storage", () => ({
  putObject: (...args: unknown[]) => putObject(...args),
  generateDownloadUrl: (...args: unknown[]) => generateDownloadUrl(...args),
}));

// --- @/lib/filenames: real (pure), but stub to keep it deterministic. ---
vi.mock("@/lib/filenames", () => ({
  buildListingSlug: (name: string, idSuffix: string) =>
    `${name.toLowerCase().replace(/\s+/g, "-")}-${idSuffix}`,
}));

// --- @/lib/logger: assert the guard logs instead of throwing. ---
const logError = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...args: unknown[]) => logError(...args) }));

// --- @/app/actions/files: createDraftFileForPrint, per-part. ---
const createDraftFileForPrint = vi.fn();
vi.mock("@/app/actions/files", () => ({
  createDraftFileForPrint: (...args: unknown[]) => createDraftFileForPrint(...args),
}));

import { persistGenerationSuccess } from "@/lib/cad/persist";

function part(name: string, hasStl = true): CadPart {
  return {
    name,
    files: hasStl ? { stl: Buffer.from("stl-bytes").toString("base64") } : {},
    validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true },
  };
}

function harnessResult(parts: CadPart[]): HarnessResult {
  return {
    ok: true,
    sourceCode: "result = 1",
    attempts: 1,
    run: {
      ok: true,
      files: parts[0]?.files ?? {},
      validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true },
      parts,
    },
  };
}

describe("persistAssembly per-part upload guard (MTR-159)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertCallCount = 0;
    selectCallCount = 0;
    selectQueue = [];
    putObject.mockReset().mockImplementation(async () => undefined);
    generateDownloadUrl.mockReset().mockImplementation(
      async () => "https://example.test/render.png"
    );
    createDraftFileForPrint.mockReset().mockImplementation(
      async (params: { originalFilename: string }) => ({
        fileAssetId: `asset-${params.originalFilename}`,
        fileSlug: `slug-${params.originalFilename}`,
      })
    );
  });

  it("logs and skips a part whose R2 upload fails, and still persists the other parts", async () => {
    // part-b's upload fails; part-a and part-c succeed.
    putObject.mockImplementation(async (...args: unknown[]) => {
      const key = args[0] as string;
      if (key.includes("part-b")) throw new Error("R2 write failed");
      return undefined;
    });

    const parts = [part("part-a"), part("part-b"), part("part-c")];
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a two-part enclosure",
      isRoot: false,
      nameOverride: "Assembly",
      result: harnessResult(parts),
    });

    // Not the PersistError shape.
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unexpected failure");

    // All three parts attempted the upload...
    expect(putObject).toHaveBeenCalledTimes(3);
    // ...but only the two that succeeded got a draft file minted.
    expect(createDraftFileForPrint).toHaveBeenCalledTimes(2);
    expect(result.parts).toHaveLength(2);
    expect(result.parts?.map((p) => p.name)).toEqual(["part-a", "part-c"]);

    // The failure was logged, not thrown.
    expect(logError).toHaveBeenCalledWith(
      "persistAssembly.upload",
      expect.any(Error)
    );

    // The generation row still flips to succeeded (not failed) since 2 of 3
    // parts persisted.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" })
    );
  });

  it("fails the generation only when every part's upload fails (zero usable parts)", async () => {
    putObject.mockRejectedValue(new Error("R2 down"));

    const parts = [part("part-a"), part("part-b")];
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a two-part enclosure",
      isRoot: false,
      nameOverride: "Assembly",
      result: harnessResult(parts),
    });

    expect("error" in result).toBe(true);
    expect(createDraftFileForPrint).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "persistAssembly.upload",
      expect.any(Error)
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("succeeds normally when no part's upload fails (regression guard)", async () => {
    const parts = [part("part-a"), part("part-b")];
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a two-part enclosure",
      isRoot: false,
      nameOverride: "Assembly",
      result: harnessResult(parts),
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unexpected failure");
    expect(result.parts).toHaveLength(2);
    expect(logError).not.toHaveBeenCalledWith(
      "persistAssembly.upload",
      expect.anything()
    );
  });
});

describe("thread linkage (MTR-178, docs/text-to-cad/05 §A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertCallCount = 0;
    selectCallCount = 0;
    selectQueue = [];
    putObject.mockReset().mockImplementation(async () => undefined);
    generateDownloadUrl
      .mockReset()
      .mockImplementation(async () => "https://example.test/render.png");
    createDraftFileForPrint.mockReset().mockImplementation(
      async (params: { originalFilename: string }) => ({
        fileAssetId: `asset-${params.originalFilename}`,
        fileSlug: `slug-${params.originalFilename}`,
      })
    );
  });

  it("root generation creates a cadThreads row and stamps threadId + source='studio'", async () => {
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a bracket",
      isRoot: true,
      result: harnessResult([part("solo")]),
    });

    expect("error" in result).toBe(false);

    // Draft minted with studio provenance (docs/text-to-cad/05 §B).
    expect(createDraftFileForPrint).toHaveBeenCalledWith(
      expect.objectContaining({ source: "studio" })
    );

    // Thread created with the generated title, rooted at this generation.
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        title: "Widget Bracket",
        rootGenerationId: "gen-1",
        activeGenerationId: "gen-1",
      })
    );

    // Final row update carries the thread id (first insert returns
    // "project-1") AND the legacy root title fallback.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        threadId: "project-1",
        title: "Widget Bracket",
      })
    );
  });

  it("revision inherits the parent's threadId and bumps the thread's active generation", async () => {
    // ensureThreadForGeneration selects: (1) this row's parent pointer,
    // (2) the parent row (already threaded).
    selectQueue = [
      [{ threadId: null, parentGenerationId: "gen-parent" }],
      [{ id: "gen-parent", threadId: "thread-9", title: "Widget" }],
    ];

    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-2",
      prompt: "make it taller",
      isRoot: false,
      nameOverride: "Widget",
      result: harnessResult([part("solo")]),
    });

    expect("error" in result).toBe(false);
    // No thread row created — inherited instead.
    expect(mockInsertValues).not.toHaveBeenCalled();
    // Thread bumped to the successful revision.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ activeGenerationId: "gen-2" })
    );
    // Final generation update carries the inherited threadId.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", threadId: "thread-9" })
    );
  });

  it("lazily creates a thread for a legacy parent with none, adopting the parent as root", async () => {
    selectQueue = [
      [{ threadId: null, parentGenerationId: "gen-parent" }],
      [{ id: "gen-parent", threadId: null, title: "Old build" }],
    ];

    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-2",
      prompt: "make it taller",
      isRoot: false,
      nameOverride: "Old build",
      result: harnessResult([part("solo")]),
    });

    expect("error" in result).toBe(false);
    // Thread adopts the PARENT as root, carrying its title.
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        title: "Old build",
        rootGenerationId: "gen-parent",
        activeGenerationId: "gen-2",
      })
    );
    // The legacy parent is stamped with the new thread id...
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "project-1", updatedAt: expect.any(Date) })
    );
    // ...and so is the revision's final update.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", threadId: "project-1" })
    );
  });

  it("a thread bookkeeping failure never fails an otherwise-good generation", async () => {
    // The parent-pointer select blows up (transient DB error).
    selectQueue = [];
    mockSelectWhere.mockImplementationOnce(() => {
      throw new Error("connection reset");
    });

    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-2",
      prompt: "make it taller",
      isRoot: false,
      nameOverride: "Widget",
      result: harnessResult([part("solo")]),
    });

    expect("error" in result).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "persist.ensureThreadForGeneration",
      expect.any(Error)
    );
    // Succeeds without a threadId (legacy read path picks it up).
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" })
    );
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ threadId: expect.anything() })
    );
  });
});

describe("STEP + topology + thumbnail persistence (MTR-196 / MTR-50)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertCallCount = 0;
    selectCallCount = 0;
    selectQueue = [];
    putObject.mockReset().mockImplementation(async () => undefined);
    generateDownloadUrl
      .mockReset()
      .mockImplementation(async () => "https://example.test/render.png");
    createDraftFileForPrint.mockReset().mockImplementation(
      async (params: { originalFilename: string }) => ({
        fileAssetId: `asset-${params.originalFilename}`,
        fileSlug: `slug-${params.originalFilename}`,
      })
    );
  });

  const b64 = (s: string) => Buffer.from(s).toString("base64");

  /** Single-part run with optional STEP / render / topology attached. */
  function singleRun(opts: {
    step?: boolean;
    render?: boolean;
    topo?: boolean;
  }): HarnessResult {
    const run: Record<string, unknown> = {
      ok: true,
      files: {
        stl: b64("stl-bytes"),
        ...(opts.step ? { step: b64("step-bytes") } : {}),
      },
      validation: {
        compiled: true,
        isSolid: true,
        isWatertight: true,
        isManifold: true,
      },
      ...(opts.render ? { renderPng: b64("png-bytes") } : {}),
    };
    // `topo` is an excess field the harness passes through verbatim (not on
    // the shared CadRunResult type) — attach it structurally, as the sidecar
    // does on the wire.
    if (opts.topo) run.topo = { faces: [{ id: 0, surface: "plane" }] };
    return {
      ok: true,
      sourceCode: "result = 1",
      attempts: 1,
      run: run as unknown as HarnessResult["run"],
    };
  }

  it("persists STEP beside the STL, stamps stepStorageKey, and reports hasStep", async () => {
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a bracket",
      isRoot: true,
      result: singleRun({ step: true }),
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unexpected failure");
    expect(result.hasStep).toBe(true);

    // STEP written to a sibling `.step` key with the B-rep content type.
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/\/model\.step$/),
      expect.any(Uint8Array),
      "model/step"
    );
    // ...and stamped onto the asset row.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        stepStorageKey: expect.stringMatching(/\/model\.step$/),
      })
    );
  });

  it("persists the topology manifest under cad-topo/ and records topoStorageKey", async () => {
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a bracket",
      isRoot: true,
      result: singleRun({ step: true, topo: true }),
    });

    expect("error" in result).toBe(false);
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^cad-topo\/user-1\/.+\.json$/),
      expect.any(Uint8Array),
      "application/json"
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        topoStorageKey: expect.stringMatching(/^cad-topo\//),
      })
    );
  });

  it("wires the render to the library thumbnail (thumbnails/{fileId}.webp + thumbnailUrl)", async () => {
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a bracket",
      isRoot: true,
      result: singleRun({ render: true }),
    });

    expect("error" in result).toBe(false);
    expect(putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^thumbnails\/.+\.webp$/),
      expect.any(Uint8Array),
      "image/png"
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailUrl: expect.stringMatching(/^\/api\/thumbnails\//),
      })
    );
  });

  it("degrades gracefully with no STEP/topology/render (mesh-mode): STL only, hasStep false", async () => {
    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a bracket",
      isRoot: true,
      result: singleRun({}),
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unexpected failure");
    expect(result.hasStep).toBe(false);

    // No STEP object, no topology object, no thumbnail — no dead artifacts.
    expect(putObject).not.toHaveBeenCalledWith(
      expect.stringMatching(/\.step$/),
      expect.anything(),
      expect.anything()
    );
    expect(putObject).not.toHaveBeenCalledWith(
      expect.stringMatching(/^cad-topo\//),
      expect.anything(),
      expect.anything()
    );
    expect(mockUpdateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ stepStorageKey: expect.anything() })
    );
    // topoStorageKey is still written on the generation row, but null.
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", topoStorageKey: null })
    );
  });

  it("a STEP upload failure is swallowed — the generation still succeeds without STEP", async () => {
    putObject.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]).endsWith(".step")) throw new Error("R2 write failed");
      return undefined;
    });

    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a bracket",
      isRoot: true,
      result: singleRun({ step: true }),
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unexpected failure");
    expect(result.hasStep).toBe(false);
    expect(logError).toHaveBeenCalledWith("persist.step", expect.any(Error));
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" })
    );
  });

  it("persists a STEP per assembly part and reports per-part hasStep", async () => {
    const partWithStep = (name: string): CadPart => ({
      name,
      files: { stl: b64("stl"), step: b64("step") },
      validation: {
        compiled: true,
        isSolid: true,
        isWatertight: true,
        isManifold: true,
      },
    });

    const result = await persistGenerationSuccess({
      userId: "user-1",
      generationId: "gen-1",
      prompt: "a two-part enclosure",
      isRoot: false,
      nameOverride: "Enclosure",
      result: {
        ok: true,
        sourceCode: "parts = {}",
        attempts: 1,
        run: {
          ok: true,
          files: { stl: b64("stl"), step: b64("step") },
          validation: {
            compiled: true,
            isSolid: true,
            isWatertight: true,
            isManifold: true,
          },
          parts: [partWithStep("lid"), partWithStep("base")],
        } as HarnessResult["run"],
      },
    });

    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unexpected failure");
    // Two parts, each with a STEP sibling written.
    expect(result.parts).toHaveLength(2);
    expect(result.parts?.every((p) => p.hasStep)).toBe(true);
    expect(
      putObject.mock.calls.filter((c) => String(c[0]).endsWith(".step"))
    ).toHaveLength(2);
  });
});
