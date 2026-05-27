import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Agent SDK and child_process are the only impure dependencies the
// module pulls in at import time. Mock both so importing the module
// never spawns an agent session or shells out to `gh` — the helpers
// under test are pure, but the import must stay side-effect-free.
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

import {
  FORBIDDEN_PATHS,
  isForbiddenPath,
  normalizeEditPath,
  buildForbiddenEscalation,
  createTimeoutController,
  parseEvent,
} from "../sentry-fixer";

describe("forbidden-paths guard", () => {
  it("refuses edits to every path in the prompt's Rule 3 list", () => {
    // These are the exact files the prompt forbids the agent from
    // touching — the guard must reject all of them.
    expect(isForbiddenPath("lib/db/schema.ts")).toBe(true);
    expect(isForbiddenPath("app/actions/payouts.ts")).toBe(true);
    expect(isForbiddenPath("proxy.ts")).toBe(true);
  });

  it("rejects anything under lib/db/migrations/ (subtree match)", () => {
    expect(isForbiddenPath("lib/db/migrations/0001_init.sql")).toBe(true);
    expect(isForbiddenPath("lib/db/migrations/meta/_journal.json")).toBe(true);
    // The directory itself counts too.
    expect(isForbiddenPath("lib/db/migrations")).toBe(true);
  });

  it("rejects lib/stripe/handle-*.ts via the single-segment glob", () => {
    expect(isForbiddenPath("lib/stripe/handle-checkout.ts")).toBe(true);
    expect(isForbiddenPath("lib/stripe/handle-payment-intent.ts")).toBe(true);
    // The glob is single-segment: it must not leak into subdirectories.
    expect(isForbiddenPath("lib/stripe/handlers/handle-foo.ts")).toBe(false);
    // Must still end in .ts and start with handle-.
    expect(isForbiddenPath("lib/stripe/handle-checkout.js")).toBe(false);
    expect(isForbiddenPath("lib/stripe/client.ts")).toBe(false);
  });

  it("normalizes absolute, ./-prefixed, and backslash paths", () => {
    const abs = `${process.cwd()}/lib/db/schema.ts`;
    expect(isForbiddenPath(abs)).toBe(true);
    expect(isForbiddenPath("./lib/db/schema.ts")).toBe(true);
    expect(isForbiddenPath("/lib/db/schema.ts")).toBe(true);
    expect(isForbiddenPath("lib\\db\\schema.ts")).toBe(true);
    expect(isForbiddenPath("  lib/db/schema.ts  ")).toBe(true);
  });

  it("allows ordinary production files", () => {
    expect(isForbiddenPath("app/api/craftcloud/quotes/route.ts")).toBe(false);
    expect(isForbiddenPath("lib/db/queries/files.ts")).toBe(false);
    expect(isForbiddenPath("lib/stripe.ts")).toBe(false);
    // Substring of a forbidden path but a different file — must pass.
    expect(isForbiddenPath("lib/db/schema-helpers.ts")).toBe(false);
    expect(isForbiddenPath("components/proxy.tsx")).toBe(false);
  });

  it("treats empty / whitespace input as not-forbidden", () => {
    expect(isForbiddenPath("")).toBe(false);
    expect(isForbiddenPath("   ")).toBe(false);
  });

  it("normalizeEditPath strips cwd / leading dot-slash / backslashes", () => {
    expect(normalizeEditPath("./foo/bar.ts")).toBe("foo/bar.ts");
    expect(normalizeEditPath("foo\\bar.ts")).toBe("foo/bar.ts");
    expect(normalizeEditPath(`${process.cwd()}/foo/bar.ts`)).toBe(
      "foo/bar.ts"
    );
  });

  it("keeps FORBIDDEN_PATHS in sync with the documented set", () => {
    // Pins the contract so a future edit to the list is a conscious,
    // test-visible decision rather than silent drift from the prompt.
    expect([...FORBIDDEN_PATHS]).toEqual([
      "lib/db/schema.ts",
      "lib/db/migrations/",
      "app/actions/payouts.ts",
      "lib/stripe/handle-*.ts",
      "proxy.ts",
    ]);
  });
});

describe("buildForbiddenEscalation", () => {
  it("writes an escalation summary naming the protected file and event id", () => {
    const md = buildForbiddenEscalation(
      { event_id: "abc123def456" },
      "lib/db/schema.ts"
    );
    expect(md).toContain("Escalation");
    expect(md).toContain("abc123def456");
    expect(md).toContain("lib/db/schema.ts");
    expect(md).toContain("No production files were modified");
  });

  it("normalizes the path and falls back to issue id then (unknown)", () => {
    const md = buildForbiddenEscalation(
      { id: "999999" },
      "./app/actions/payouts.ts"
    );
    expect(md).toContain("999999");
    expect(md).toContain("app/actions/payouts.ts");

    const unknown = buildForbiddenEscalation({}, "proxy.ts");
    expect(unknown).toContain("(unknown)");
  });
});

describe("createTimeoutController (AbortController timeout path)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the signal once the timeout elapses", () => {
    const onTimeout = vi.fn();
    const { controller } = createTimeoutController(1000, onTimeout);

    expect(controller.signal.aborted).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(controller.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(true);
  });

  it("clear() cancels the pending abort (success path)", () => {
    const onTimeout = vi.fn();
    const { controller, clear } = createTimeoutController(1000, onTimeout);

    clear();
    vi.advanceTimersByTime(5000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
  });

  it("defaults onTimeout to a no-op without throwing", () => {
    const { controller } = createTimeoutController(10);
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("parseEvent", () => {
  it("parses a well-formed Sentry event", () => {
    const event = parseEvent(
      JSON.stringify({ event_id: "deadbeef", level: "error" })
    );
    expect(event.event_id).toBe("deadbeef");
    expect(event.level).toBe("error");
  });

  it("treats empty input as an empty event (graceful degradation)", () => {
    expect(parseEvent("")).toEqual({});
  });

  it("throws a clear error on malformed JSON", () => {
    expect(() => parseEvent("{not valid json")).toThrow(
      /Could not parse Sentry event JSON/
    );
  });

  it("does not spawn the agent or shell out on import", () => {
    // Sanity: importing the module must be side-effect-free.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
