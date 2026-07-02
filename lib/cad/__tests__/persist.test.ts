import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessResult } from "@/lib/cad/harness";
import type { CadPart } from "@/lib/cad/types";

// --- @/lib/db/schema: minimal column-reference stubs (drizzle-orm's real
// eq()/and() just wrap these into expression objects; identity doesn't
// matter to our mocked db below). ---
vi.mock("@/lib/db/schema", () => ({
  cadGenerations: { id: "id" },
  files: { id: "id", slug: "slug", userId: "user_id" },
  projects: { id: "id", slug: "slug" },
  projectFiles: { projectId: "project_id", fileId: "file_id", position: "position" },
}));

// --- @/lib/db: track insert/select/update calls; the first insert() call
// in persistAssembly is always the Project insert (.returning()), the
// second is the projectFiles link insert (no .returning()). ---
const mockUpdateSet = vi.fn();
const mockInsertValues = vi.fn();
const mockSelectWhere = vi.fn();

let insertCallCount = 0;
let selectCallCount = 0;

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
        const isProjectInsert = insertCallCount === 1;
        const p = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<Array<{ slug: string; id: string }>>;
        };
        p.returning = async () =>
          isProjectInsert ? [{ slug: "assembly-slug", id: "project-1" }] : [];
        return p;
      },
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          selectCallCount++;
          mockSelectWhere();
          const row = { id: `file-id-${selectCallCount}` };
          return Object.assign([row], { limit: () => [row] });
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
