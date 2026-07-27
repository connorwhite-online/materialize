import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * FIX-3 (cycle-3 codebase-health + Text-to-CAD audit, 2026-07-27):
 * runCadTemplate, rerunCadWithParams, and reviseCadFeatureStatement each
 * drive a real billed sidecar exec (and reviseCadFeatureStatement also a
 * model completion) but, unlike POST /api/cad/generate, none called
 * checkCadGenerateRateLimit — the per-user frequency backstop from MTR-169.
 * These tests assert all three now call the limiter and short-circuit
 * (never reaching the sidecar/model call) when it returns not-ok.
 */

let allowed = true;
vi.mock("@/lib/features", () => ({
  canUseTextToCad: vi.fn(() => allowed),
}));

let rateResult: { ok: true } | { ok: false; count: number; limit: number; windowMinutes: number; retryAfterSeconds: number } = { ok: true };
const checkCadGenerateRateLimit = vi.fn((..._args: unknown[]) =>
  Promise.resolve(rateResult)
);
vi.mock("@/app/api/cad/generate/rate-limit", () => ({
  checkCadGenerateRateLimit: (...args: unknown[]) => checkCadGenerateRateLimit(...args),
}));

const runCadCode = vi.fn();
vi.mock("@/lib/cad/runner-client", () => ({
  runCadCode: (...args: unknown[]) => runCadCode(...args),
}));

const completeText = vi.fn();
vi.mock("@/lib/cad/model-client", () => ({
  completeText: (...args: unknown[]) => completeText(...args),
}));

vi.mock("@/lib/cad/persist", () => ({
  persistGenerationFailure: vi.fn(),
  persistGenerationSuccess: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  deleteObject: vi.fn(),
  generateDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  cadGenerations: { __name: "cad_generations", id: "id", userId: "user_id" },
  cadThreads: { __name: "cad_threads", id: "id", userId: "user_id" },
  cartItems: { __name: "cart_items", id: "id" },
  fileAssets: { __name: "file_assets", id: "id" },
  files: { __name: "files", id: "id" },
  printOrderItems: { __name: "print_order_items", id: "id" },
  printOrders: { __name: "print_orders", id: "id" },
  projectFiles: { __name: "project_files", id: "id" },
}));

const insert = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => insert(...args),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
  },
}));

import {
  runCadTemplate,
  rerunCadWithParams,
  reviseCadFeatureStatement,
} from "@/app/actions/cad-generation";

describe("studio server actions honor the CAD generate rate limit (MTR-169 backstop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowed = true;
    rateResult = { ok: true };
    // insert() is only hit on the happy path in these actions; each test
    // here rejects before that point, so any shape is fine as a fallback.
    insert.mockReturnValue({
      values: () => ({ returning: () => Promise.resolve([{ id: "gen-x" }]) }),
    });
  });

  it("runCadTemplate rejects and never runs the sidecar when rate-limited", async () => {
    rateResult = {
      ok: false,
      count: 40,
      limit: 40,
      windowMinutes: 10,
      retryAfterSeconds: 30,
    };

    const result = await runCadTemplate({
      exemplarId: "anything",
      params: {},
    });

    expect(checkCadGenerateRateLimit).toHaveBeenCalledWith("test-user-id");
    expect(result).toEqual({
      error:
        "You've started 40 generations in the last 10 minutes. Give it a moment and try again.",
    });
    expect(runCadCode).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rerunCadWithParams rejects and never runs the sidecar when rate-limited", async () => {
    rateResult = {
      ok: false,
      count: 41,
      limit: 40,
      windowMinutes: 10,
      retryAfterSeconds: 5,
    };

    const result = await rerunCadWithParams({
      generationId: "gen-1",
      params: { x: 1 },
    });

    expect(checkCadGenerateRateLimit).toHaveBeenCalledWith("test-user-id");
    expect(result).toEqual({
      error:
        "You've started 41 generations in the last 10 minutes. Give it a moment and try again.",
    });
    expect(runCadCode).not.toHaveBeenCalled();
  });

  it("reviseCadFeatureStatement rejects and never calls the model or the sidecar when rate-limited", async () => {
    rateResult = {
      ok: false,
      count: 55,
      limit: 40,
      windowMinutes: 10,
      retryAfterSeconds: 60,
    };

    const result = await reviseCadFeatureStatement({
      generationId: "gen-1",
      featureId: "feat-1",
      instruction: "make it bigger",
    });

    expect(checkCadGenerateRateLimit).toHaveBeenCalledWith("test-user-id");
    expect(result).toEqual({
      error:
        "You've started 55 generations in the last 10 minutes. Give it a moment and try again.",
    });
    expect(completeText).not.toHaveBeenCalled();
    expect(runCadCode).not.toHaveBeenCalled();
  });

  it("does not call the limiter's caller id-mismatched and still gates on the auth'd user (sanity: allowed path reaches past the check)", async () => {
    // ok:true path — the action should proceed past the rate check (it will
    // go on to fail later for unrelated reasons, e.g. "Template not found.",
    // which is fine — we're only asserting the limiter did not block it).
    rateResult = { ok: true };
    const result = await runCadTemplate({ exemplarId: "does-not-exist", params: {} });
    expect(checkCadGenerateRateLimit).toHaveBeenCalledWith("test-user-id");
    expect(result).toEqual({ error: "Template not found." });
  });
});
