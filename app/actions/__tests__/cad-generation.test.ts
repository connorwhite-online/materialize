import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-test knobs.
let allowed = true;
let parentRows: Array<{ sourceCode: string | null; userId: string }> = [];
let harnessResult: unknown;
const updatedRows: Array<Record<string, unknown>> = [];

// Hoisted so the mock factories below (which run before the const
// initializers) can return them without a TDZ error.
const { putObject, generateDownloadUrl, createDraftFileForPrint } = vi.hoisted(
  () => ({
    putObject: vi.fn(() => Promise.resolve()),
    generateDownloadUrl: vi.fn(() =>
      Promise.resolve("https://r2.example/signed/render.png")
    ),
    createDraftFileForPrint: vi.fn(() =>
      Promise.resolve({ fileAssetId: "asset-1", fileSlug: "thing-abc123" })
    ),
  })
);

vi.mock("@/lib/features", () => ({
  canUseTextToCad: vi.fn(() => allowed),
}));

vi.mock("@/lib/cad/harness", () => ({
  runHarness: vi.fn(() => Promise.resolve(harnessResult)),
}));

vi.mock("@/lib/storage", () => ({ putObject, generateDownloadUrl }));

vi.mock("@/app/actions/files", () => ({ createDraftFileForPrint }));

vi.mock("@/lib/db/schema", () => ({
  cadGenerations: {
    __name: "cad_generations",
    id: "id",
    userId: "user_id",
    sourceCode: "source_code",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ returning: () => [{ id: "gen-1" }] }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => parentRows }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          updatedRows.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { generateCadModel } from "@/app/actions/cad-generation";
import { runHarness } from "@/lib/cad/harness";

const okHarness = {
  ok: true,
  sourceCode: "result = 1",
  attempts: 1,
  run: {
    ok: true,
    files: { stl: Buffer.from("x").toString("base64") },
    renderPng: "iVBORw0=",
    validation: { compiled: true, isSolid: true, isWatertight: true, isManifold: true },
  },
};

describe("generateCadModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowed = true;
    parentRows = [];
    harnessResult = okHarness;
    updatedRows.length = 0;
  });

  it("404-equivalents when the caller isn't allowed (no generation row)", async () => {
    allowed = false;
    const res = await generateCadModel({ prompt: "a cube" });
    expect(res).toEqual({ error: "Not found" });
    expect(runHarness).not.toHaveBeenCalled();
  });

  it("rejects a too-short prompt before running the harness", async () => {
    const res = await generateCadModel({ prompt: "a" });
    expect("error" in res).toBe(true);
    expect(runHarness).not.toHaveBeenCalled();
  });

  it("happy path: uploads STL + render, mints a draft, returns the asset id", async () => {
    const res = await generateCadModel({ prompt: "a 20mm cube" });
    // Two writes: the printable STL and the preview render.
    expect(putObject).toHaveBeenCalledTimes(2);
    // STL lives under the caller's uploads/ prefix (ownership guard).
    expect((putObject.mock.calls[0] as unknown[])[0]).toMatch(
      /^uploads\/test-user-id\/.*model\.stl$/
    );
    // Render lives under a distinct prefix so upload sweeps never touch it.
    expect((putObject.mock.calls[1] as unknown[])[0]).toMatch(
      /^cad-renders\/test-user-id\//
    );
    expect(createDraftFileForPrint).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      fileAssetId: "asset-1",
      fileSlug: "thing-abc123",
      renderUrl: "https://r2.example/signed/render.png",
    });
    // Row marked succeeded, render persisted as an R2 key (not inline).
    const last = updatedRows.at(-1)!;
    expect(last).toMatchObject({ status: "succeeded", fileAssetId: "asset-1" });
    expect(last.renderStorageKey).toMatch(/^cad-renders\/test-user-id\//);
  });

  it("marks the row failed and returns an error when the harness fails", async () => {
    harnessResult = { ok: false, sourceCode: "bad", attempts: 3, error: "not watertight" };
    const res = await generateCadModel({ prompt: "a cube" });
    expect("error" in res && res.error).toBe("not watertight");
    expect(createDraftFileForPrint).not.toHaveBeenCalled();
    expect(updatedRows.at(-1)).toMatchObject({ status: "failed" });
  });

  it("rejects editing a generation the caller doesn't own", async () => {
    parentRows = [{ sourceCode: "result = 1", userId: "someone-else" }];
    const res = await generateCadModel({
      prompt: "make it taller",
      parentGenerationId: "gen-parent",
    });
    expect("error" in res).toBe(true);
    expect(runHarness).not.toHaveBeenCalled();
  });

  it("passes prior source code into the harness when editing an owned generation", async () => {
    parentRows = [{ sourceCode: "result = 42", userId: "test-user-id" }];
    await generateCadModel({
      prompt: "make it taller",
      parentGenerationId: "gen-parent",
    });
    expect(runHarness).toHaveBeenCalledWith(
      expect.objectContaining({ priorSourceCode: "result = 42" })
    );
  });
});
