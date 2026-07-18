import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HarnessResult } from "@/lib/cad/harness";
import type { CadJobProgressEntry, CadProgressEvent } from "@/lib/cad/types";

// --- @/lib/db/schema: minimal column-reference stubs (drizzle's eq()/and()
// just wrap these; identity doesn't matter to the mocked db below). ---
vi.mock("@/lib/db/schema", () => ({
  cadJobs: {
    id: "id",
    generationId: "generation_id",
    status: "status",
    progress: "progress",
    error: "error",
    cancelRequestedAt: "cancel_requested_at",
    answers: "answers",
    startedAt: "started_at",
    finishedAt: "finished_at",
    usage: "usage",
    costCents: "cost_cents",
  },
  cadGenerations: { id: "id", userId: "user_id" },
  cadCreditLedger: {
    id: "id",
    userId: "user_id",
    delta: "delta",
    reason: "reason",
    generationId: "generation_id",
    jobId: "job_id",
    printOrderId: "print_order_id",
    note: "note",
    createdAt: "created_at",
  },
  printOrders: { id: "id", userId: "user_id" },
}));

// --- @/lib/db: a single simulated job row. select() always returns a copy
// of it; update().set() records the patch and folds it back in, so the
// read-modify-write in appendJobProgress and the cancel poll both behave
// like the real table. ---
type JobRow = {
  progress: CadJobProgressEntry[];
  cancelRequestedAt: Date | null;
  answers: Record<string, string>;
};
let jobRow: JobRow;
const updateCalls: Array<Record<string, unknown>> = [];
const insertValues = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertValues(v);
        return {
          returning: () => Promise.resolve([{ id: "job-1" }]),
          // Ledger writes (lib/billing/cad-credits.ts) chain
          // .onConflictDoNothing() and await it directly.
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updateCalls.push(v);
        if (Array.isArray(v.progress)) {
          jobRow.progress = v.progress as CadJobProgressEntry[];
        }
        if (v.cancelRequestedAt instanceof Date) {
          jobRow.cancelRequestedAt = v.cancelRequestedAt;
        }
        if (v.answers && typeof v.answers === "object") {
          jobRow.answers = v.answers as Record<string, string>;
        }
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => {
          const row = {
            progress: [...jobRow.progress],
            cancelRequestedAt: jobRow.cancelRequestedAt,
            answers: { ...jobRow.answers },
          };
          const arr = [row];
          return Object.assign(arr, { limit: () => arr });
        },
      }),
    }),
  },
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

// --- collaborators of executeCadJob ---
const runHarness = vi.fn();
vi.mock("@/lib/cad/harness", () => ({
  runHarness: (...args: unknown[]) => runHarness(...args),
}));

vi.mock("@/lib/cad/generative", () => ({
  generativeEnabled: () => false,
  shouldUseGenerative: vi.fn(),
  runGenerative: vi.fn(),
}));

const persistGenerationFailure = vi.fn(async (...args: unknown[]) => ({
  error: args[1] as string,
  generationId: args[0] as string,
}));
const persistGenerationSuccess = vi.fn();
vi.mock("@/lib/cad/persist", () => ({
  persistGenerationFailure: (...args: unknown[]) =>
    persistGenerationFailure(...args),
  persistGenerationSuccess: (...args: unknown[]) =>
    persistGenerationSuccess(...args),
}));

import {
  createCadJob,
  appendJobProgress,
  executeCadJob,
  JOB_TIMEOUT_MESSAGE,
  MAX_PROGRESS_EVENTS,
} from "@/lib/cad/jobs";

function phaseEvent(attempt: number): CadProgressEvent {
  return { type: "phase", phase: "generating", attempt, maxAttempts: 4 };
}

function okHarnessResult(): HarnessResult {
  return {
    ok: true,
    sourceCode: "result = 1",
    attempts: 1,
    run: {
      ok: true,
      files: { stl: "c3Rs" },
      validation: {
        compiled: true,
        isSolid: true,
        isWatertight: true,
        isManifold: true,
      },
    },
  };
}

const baseInput = {
  jobId: "job-1",
  generationId: "gen-1",
  userId: "user-1",
  prompt: "a 20mm cube",
};

beforeEach(() => {
  vi.clearAllMocks();
  jobRow = { progress: [], cancelRequestedAt: null, answers: {} };
  updateCalls.length = 0;
  delete process.env.CAD_MAX_QUESTIONS_PER_JOB;
  delete process.env.CAD_CREDITS_ENABLED;
  delete process.env.CAD_CREDIT_COST_SIMPLE;
  delete process.env.CAD_JOB_COMPUTE_BUDGET_MS;
  persistGenerationFailure.mockImplementation(async (...args: unknown[]) => ({
    error: args[1] as string,
    generationId: args[0] as string,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CAD_JOB_COMPUTE_BUDGET_MS;
});

describe("createCadJob", () => {
  it("inserts a queued row for the generation and returns the job id", async () => {
    const res = await createCadJob("gen-1");
    expect(res).toEqual({ jobId: "job-1" });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "gen-1", status: "queued" })
    );
  });
});

describe("appendJobProgress", () => {
  it("appends to the existing progress array", async () => {
    jobRow.progress = [phaseEvent(1)];
    await appendJobProgress("job-1", [phaseEvent(2), phaseEvent(3)]);
    expect(jobRow.progress).toHaveLength(3);
    expect(jobRow.progress[2]).toEqual(phaseEvent(3));
  });

  it("caps the array at MAX_PROGRESS_EVENTS, keeping the first and last entries", async () => {
    jobRow.progress = Array.from({ length: MAX_PROGRESS_EVENTS }, (_, i) =>
      phaseEvent(i)
    );
    const appended: CadJobProgressEntry = {
      type: "error",
      error: "boom",
      generationId: "gen-1",
    };
    await appendJobProgress("job-1", appended);

    expect(jobRow.progress).toHaveLength(MAX_PROGRESS_EVENTS);
    // First entry survives (the setup story)...
    expect(jobRow.progress[0]).toEqual(phaseEvent(0));
    // ...and the newest entry survives (the current state / terminal record).
    expect(jobRow.progress[jobRow.progress.length - 1]).toEqual(appended);
  });

  it("no-ops on an empty batch", async () => {
    await appendJobProgress("job-1", []);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("executeCadJob", () => {
  it("marks the job running then done, and appends a terminal `done` record", async () => {
    runHarness.mockImplementation(
      async (input: { onProgress?: (e: CadProgressEvent) => void }) => {
        input.onProgress?.(phaseEvent(1));
        input.onProgress?.({
          type: "phase",
          phase: "executing",
          attempt: 1,
          maxAttempts: 4,
        });
        return okHarnessResult();
      }
    );
    persistGenerationSuccess.mockResolvedValue({
      generationId: "gen-1",
      fileAssetId: "asset-1",
      fileSlug: "slug-1",
      renderUrl: "https://example.test/r.png",
      sourceCode: "result = 1",
      title: "Cube",
      remeshed: false,
    });

    await executeCadJob(baseInput);

    // Status walked queued -> running -> done.
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "running", startedAt: expect.any(Date) })
    );
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "done", finishedAt: expect.any(Date) })
    );

    // Progress captured the harness events AND ends with the terminal record.
    const last = jobRow.progress[jobRow.progress.length - 1];
    expect(last).toEqual(
      expect.objectContaining({
        type: "done",
        generationId: "gen-1",
        fileAssetId: "asset-1",
        fileSlug: "slug-1",
      })
    );
    expect(jobRow.progress).toContainEqual(phaseEvent(1));
    expect(persistGenerationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        generationId: "gen-1",
        isRoot: true,
      })
    );
  });

  it("marks the job failed (error column + terminal error record) on a bad result", async () => {
    runHarness.mockResolvedValue({
      ok: false,
      sourceCode: "broken",
      attempts: 4,
      error: "not watertight",
    } satisfies HarnessResult);

    await executeCadJob(baseInput);

    expect(persistGenerationFailure).toHaveBeenCalledWith(
      "gen-1",
      "not watertight",
      "broken",
      4
    );
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error: "not watertight",
        finishedAt: expect.any(Date),
      })
    );
    const last = jobRow.progress[jobRow.progress.length - 1];
    expect(last).toEqual({
      type: "error",
      error: "not watertight",
      generationId: "gen-1",
    });
    expect(persistGenerationSuccess).not.toHaveBeenCalled();
  });

  it("marks the job cancelled without running the harness when cancel raced the start", async () => {
    jobRow.cancelRequestedAt = new Date();

    await executeCadJob(baseInput);

    expect(runHarness).not.toHaveBeenCalled();
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: "cancelled",
        finishedAt: expect.any(Date),
      })
    );
    // The generation row doesn't hang at `pending`.
    expect(persistGenerationFailure).toHaveBeenCalledWith(
      "gen-1",
      "Generation cancelled."
    );
    const last = jobRow.progress[jobRow.progress.length - 1];
    expect(last).toEqual({
      type: "error",
      error: "Generation cancelled.",
      generationId: "gen-1",
    });
  });

  it("aborts a running harness and marks cancelled when cancelRequestedAt is set mid-run", async () => {
    vi.useFakeTimers();
    // A harness that only finishes when its signal aborts.
    runHarness.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        })
    );

    const running = executeCadJob(baseInput);
    // Let the pre-check + running-mark settle, then request cancellation.
    await vi.advanceTimersByTimeAsync(0);
    jobRow.cancelRequestedAt = new Date();
    // Advance past the ~3s cancel poll so it notices and aborts.
    await vi.advanceTimersByTimeAsync(3_100);
    await running;

    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: "cancelled",
        finishedAt: expect.any(Date),
      })
    );
    expect(persistGenerationFailure).toHaveBeenCalledWith(
      "gen-1",
      "Generation cancelled."
    );
  });

  it("marks failed (not cancelled) when the compute budget elapses mid-run", async () => {
    vi.useFakeTimers();
    process.env.CAD_JOB_COMPUTE_BUDGET_MS = "50";
    runHarness.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        })
    );

    const running = executeCadJob(baseInput);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60);
    await running;

    expect(persistGenerationFailure).toHaveBeenCalledWith(
      "gen-1",
      JOB_TIMEOUT_MESSAGE
    );
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        status: "failed",
        error: JOB_TIMEOUT_MESSAGE,
        finishedAt: expect.any(Date),
      })
    );
    const last = jobRow.progress[jobRow.progress.length - 1];
    expect(last).toEqual({
      type: "error",
      error: JOB_TIMEOUT_MESSAGE,
      generationId: "gen-1",
    });
  });

  // --- Interactive specification (MTR-191) -------------------------------
  const questionInput = {
    id: "q1",
    text: "Which board?",
    options: [
      { id: "esp32", label: "ESP32" },
      { id: "pico", label: "Pico" },
    ],
    defaultOptionId: "esp32",
  };

  function doneSuccess() {
    persistGenerationSuccess.mockResolvedValue({
      generationId: "gen-1",
      fileAssetId: "asset-1",
      fileSlug: "slug-1",
      renderUrl: null,
      sourceCode: "result = 1",
      title: "Part",
      remeshed: false,
    });
  }

  it("suspends on a question, resumes with the user's pick, and records the Q/A", async () => {
    doneSuccess();
    // The answer is already in the column when the harness asks — the first
    // poll finds it, so no fake timers needed.
    jobRow.answers = { q1: "pico" };
    let chosen: string | undefined;
    runHarness.mockImplementation(
      async (input: {
        onQuestion?: (q: typeof questionInput) => Promise<string>;
      }) => {
        chosen = await input.onQuestion?.(questionInput);
        return okHarnessResult();
      }
    );

    await executeCadJob(baseInput);

    expect(chosen).toBe("pico");
    // Status walked ... running -> awaiting_input -> running -> done.
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ status: "awaiting_input" })
    );
    // The question + its resolution both land in the persisted progress log.
    expect(jobRow.progress).toContainEqual(
      expect.objectContaining({ type: "question", questionId: "q1" })
    );
    expect(jobRow.progress).toContainEqual(
      expect.objectContaining({
        type: "answer",
        questionId: "q1",
        optionId: "pico",
        viaDefault: false,
      })
    );
  });

  it("proceeds with the default WITHOUT suspending when the budget is 0", async () => {
    doneSuccess();
    process.env.CAD_MAX_QUESTIONS_PER_JOB = "0";
    let chosen: string | undefined;
    runHarness.mockImplementation(
      async (input: {
        onQuestion?: (q: typeof questionInput) => Promise<string>;
      }) => {
        chosen = await input.onQuestion?.(questionInput);
        return okHarnessResult();
      }
    );

    await executeCadJob(baseInput);

    // Default taken, and the job never entered awaiting_input nor emitted a
    // question event — the kill switch is a clean no-op.
    expect(chosen).toBe("esp32");
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({ status: "awaiting_input" })
    );
    expect(
      jobRow.progress.some((e) => e.type === "question")
    ).toBe(false);
  });

  it("falls back to the default when a stale answer names an option we never offered", async () => {
    doneSuccess();
    jobRow.answers = { q1: "not-an-option" };
    let chosen: string | undefined;
    runHarness.mockImplementation(
      async (input: {
        onQuestion?: (q: typeof questionInput) => Promise<string>;
      }) => {
        chosen = await input.onQuestion?.(questionInput);
        return okHarnessResult();
      }
    );

    await executeCadJob(baseInput);

    expect(chosen).toBe("esp32");
    expect(jobRow.progress).toContainEqual(
      expect.objectContaining({
        type: "answer",
        questionId: "q1",
        optionId: "esp32",
        viaDefault: true,
      })
    );
  });

  it("honors a free-text custom answer instead of the default (MTR-216)", async () => {
    doneSuccess();
    // The always-present custom field stores a sentinel-encoded answer that
    // matches no preset option — it must be honored, not treated as stale.
    jobRow.answers = { q1: "custom:a Pi 5 with the PoE HAT" };
    let chosen: string | undefined;
    runHarness.mockImplementation(
      async (input: {
        onQuestion?: (q: typeof questionInput) => Promise<string>;
      }) => {
        chosen = await input.onQuestion?.(questionInput);
        return okHarnessResult();
      }
    );

    await executeCadJob(baseInput);

    // onQuestion returns the raw encoded value so the harness/agentic consumer
    // can decode it; the recorded answer is NOT viaDefault and its label is the
    // decoded text (never the raw sentinel).
    expect(chosen).toBe("custom:a Pi 5 with the PoE HAT");
    expect(jobRow.progress).toContainEqual(
      expect.objectContaining({
        type: "answer",
        questionId: "q1",
        optionId: "custom:a Pi 5 with the PoE HAT",
        label: "a Pi 5 with the PoE HAT",
        viaDefault: false,
      })
    );
  });
});

// --- Metering + credits substrate (MTR-181) --------------------------------
describe("executeCadJob metering + credit debits", () => {
  function successRun() {
    runHarness.mockResolvedValue(okHarnessResult());
    persistGenerationSuccess.mockResolvedValue({
      generationId: "gen-1",
      fileAssetId: "asset-1",
      fileSlug: "slug-1",
      renderUrl: null,
      sourceCode: "result = 1",
      title: "Part",
      remeshed: false,
    });
  }

  it("PROOF OF INERTNESS: with flags at defaults, a successful job stamps raw usage + costCents 0 and writes NOTHING else", async () => {
    successRun();
    await executeCadJob(baseInput);

    // The terminal patch carries the usage summary and a 0-cent rollup
    // (every CAD_PRICE_* defaults to 0 = metering-only).
    const done = updateCalls.find((c) => c.status === "done");
    expect(done).toBeDefined();
    expect(done!.costCents).toBe(0);
    expect(done!.usage).toEqual(
      expect.objectContaining({
        v: 1,
        model: [],
        sidecar: { calls: 0, ms: 0 },
        fal: [],
        route: "legacy", // no credentials/sessions in tests → legacy path
      })
    );

    // And the credit ledger saw nothing: CAD_CREDITS_ENABLED defaults off,
    // so the ONLY inserts ever made are job-row inserts (none in this run).
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("stamps usage on FAILED jobs too (failures cost real money; they are just never debited)", async () => {
    runHarness.mockResolvedValue({
      ok: false,
      sourceCode: "broken",
      attempts: 4,
      error: "not watertight",
    } satisfies HarnessResult);

    await executeCadJob(baseInput);

    const failed = updateCalls.find((c) => c.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.usage).toEqual(expect.objectContaining({ v: 1 }));
    expect(failed!.costCents).toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("flag ON + priced tier: a successful job writes exactly one negative ledger row", async () => {
    process.env.CAD_CREDITS_ENABLED = "true";
    process.env.CAD_CREDIT_COST_SIMPLE = "2";
    successRun();

    await executeCadJob(baseInput);

    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        delta: -2,
        reason: "generation",
        jobId: "job-1",
        generationId: "gen-1",
      })
    );
  });

  it("flag ON but price 0 (the flag-on default): still no ledger writes", async () => {
    process.env.CAD_CREDITS_ENABLED = "true";
    successRun();
    await executeCadJob(baseInput);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("failed jobs are never debited even with the flag on and a price set", async () => {
    process.env.CAD_CREDITS_ENABLED = "true";
    process.env.CAD_CREDIT_COST_SIMPLE = "2";
    runHarness.mockResolvedValue({
      ok: false,
      sourceCode: "broken",
      attempts: 4,
      error: "boom",
    } satisfies HarnessResult);

    await executeCadJob(baseInput);

    expect(insertValues).not.toHaveBeenCalled();
  });
});
