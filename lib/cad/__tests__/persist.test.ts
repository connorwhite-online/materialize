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
