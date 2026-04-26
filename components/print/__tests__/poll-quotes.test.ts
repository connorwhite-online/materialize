import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollQuotes, wait } from "../poll-quotes";
import type { EnrichedQuote } from "../material-picker/types";

function makeQuote(id: string, materialId = "mat-1"): EnrichedQuote {
  return {
    quoteId: id,
    vendorId: "v-1",
    vendorName: "Test Vendor",
    vendorCountryCode: "US",
    modelId: "m-1",
    materialConfigId: id,
    quantity: 1,
    price: 10,
    currency: "USD",
    productionTimeFast: 3,
    productionTimeSlow: 7,
    scale: 1,
    materialId,
    materialName: "PLA",
    materialGroupId: "plastics",
    materialGroupName: "Plastics",
    materialImage: null,
    finishGroupId: "standard",
    finishGroupName: "Standard",
    finishGroupImage: null,
    color: "white",
    colorCode: "#ffffff",
    configName: "PLA Standard White",
  };
}

function mockFetchSequence(responses: unknown[]) {
  let i = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => {
      const body = responses[Math.min(i, responses.length - 1)];
      i++;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
}

describe("pollQuotes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("breaks on allComplete=true once the count is stable for 4 polls", async () => {
    const q1 = makeQuote("q1");
    const q2 = makeQuote("q2");
    mockFetchSequence([
      // Poll 1: growing
      { quotes: [q1], shipping: [], allComplete: false },
      // Poll 2: growing
      { quotes: [q1, q2], shipping: [], allComplete: true },
      // Polls 3-6: same count, allComplete=true → breaks after stablePolls=4
      { quotes: [q1, q2], shipping: [], allComplete: true },
      { quotes: [q1, q2], shipping: [], allComplete: true },
      { quotes: [q1, q2], shipping: [], allComplete: true },
      { quotes: [q1, q2], shipping: [], allComplete: true },
    ]);

    const controller = new AbortController();
    const snapshots: number[] = [];
    const done = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: (s) => snapshots.push(s.quotes.length),
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toBe("complete");

    // First two snapshots grow (1 → 2), then we need 4 more
    // "stable" snapshots before the loop breaks.
    expect(snapshots.slice(0, 2)).toEqual([1, 2]);
    expect(snapshots.length).toBeGreaterThanOrEqual(6);
    // Every snapshot from index 1 onward has count 2.
    for (const count of snapshots.slice(1)) {
      expect(count).toBe(2);
    }
  });

  it("returns 'timeout' when the hard ceiling is reached without stability", async () => {
    // Quotes never stabilize: every poll grows the count by 1, so
    // stablePolls never reaches STABLE_POLLS_REQUIRED.
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      n++;
      const quotes = Array.from({ length: n }, (_, i) =>
        makeQuote(`q${i}`)
      );
      return new Response(
        JSON.stringify({ quotes, shipping: [], allComplete: false }),
        { status: 200 }
      );
    });

    const controller = new AbortController();
    const done = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: () => void 0,
    });

    // Advance well past the 90s ceiling.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await done).toBe("timeout");
  });

  it("returns 'aborted' when the signal fires", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            quotes: [makeQuote("q1")],
            shipping: [],
            allComplete: false,
          }),
          { status: 200 }
        )
    );

    const controller = new AbortController();
    const done = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: () => void 0,
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await done).toBe("aborted");
  });

  it("does NOT break on a single allComplete=true with empty quotes", async () => {
    // This is the library-modelId bug case: first snapshot returns
    // allComplete=true with no quotes. Loop must keep polling.
    const q = makeQuote("q1");
    mockFetchSequence([
      // First snapshot: over-eager allComplete with zero quotes.
      { quotes: [], shipping: [], allComplete: true },
      // Then quotes land.
      { quotes: [q], shipping: [], allComplete: false },
      { quotes: [q], shipping: [], allComplete: true },
      { quotes: [q], shipping: [], allComplete: true },
      { quotes: [q], shipping: [], allComplete: true },
      { quotes: [q], shipping: [], allComplete: true },
    ]);

    const controller = new AbortController();
    const snapshots: number[] = [];
    const done = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: (s) => snapshots.push(s.quotes.length),
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    // First snapshot is empty, then 5 snapshots of count=1.
    expect(snapshots[0]).toBe(0);
    // The loop keeps going past the empty-complete snapshot.
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots.some((c) => c === 1)).toBe(true);
  });

  it("aborts immediately when the signal fires", async () => {
    const calls: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls.push(Date.now());
      return new Response(
        JSON.stringify({
          quotes: [makeQuote("q1")],
          shipping: [],
          allComplete: false,
        }),
        { status: 200 }
      );
    });

    const controller = new AbortController();
    const done = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: () => void 0,
    });

    // Let it run one iteration then abort.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    // Regardless of how many polls ran before abort, the loop
    // should have stopped after the controller fired.
    const callsAfterAbort = calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(callsAfterAbort);
  });

  it("retries transient poll errors instead of dying", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call++;
      if (call === 1) {
        return new Response("upstream", { status: 502 });
      }
      return new Response(
        JSON.stringify({
          quotes: [makeQuote("q1"), makeQuote("q2")],
          shipping: [],
          allComplete: true,
        }),
        { status: 200 }
      );
    });

    const controller = new AbortController();
    const snapshots: number[] = [];
    const done = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: (s) => snapshots.push(s.quotes.length),
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await done;

    // The 502 was skipped; subsequent snapshots have 2 quotes.
    expect(snapshots.every((c) => c === 2)).toBe(true);
    expect(snapshots.length).toBeGreaterThan(0);
  });
});

describe("wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the timeout", async () => {
    const controller = new AbortController();
    const p = wait(100, controller.signal);
    const spy = vi.fn();
    p.then(spy);
    await vi.advanceTimersByTimeAsync(99);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(spy).toHaveBeenCalled();
  });

  it("rejects with AbortError when the signal fires mid-wait", async () => {
    const controller = new AbortController();
    const p = wait(5000, controller.signal);
    const rejected = vi.fn();
    p.catch(rejected);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toHaveBeenCalled();
    const err = rejected.mock.calls[0][0] as Error;
    expect(err.name).toBe("AbortError");
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(wait(100, controller.signal)).rejects.toThrow("Aborted");
  });
});
