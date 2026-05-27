// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import type { EnrichedQuote } from "../material-picker/types";
import type { QuoteSnapshot } from "../poll-quotes";

// CON-38 — the quote-stability gate, tested against the REAL pollQuotes
// loop (the module that owns the invariant AGENTS.md flags as load-
// bearing). This lives in its own file so it can exercise the genuine
// implementation; the QuoteConfigurator wiring test (sibling file)
// mocks pollQuotes out, and a module mock there would otherwise leak
// into these assertions.
//
// Invariant: we do NOT trust CraftCloud's `allComplete` flag alone — it
// can flip true with an empty array on cached library modelIds, or while
// late vendors are still responding. The loop only exits 'complete' when
// allComplete is true AND the quote count has been stable for
// STABLE_POLLS_REQUIRED (4) consecutive polls.

import { pollQuotes } from "../poll-quotes";

function snapshotResponse(snapshot: QuoteSnapshot): Response {
  return {
    ok: true,
    status: 200,
    json: async () => snapshot,
  } as unknown as Response;
}

function fakeQuote(id: string): EnrichedQuote {
  return {
    quoteId: id,
    vendorId: `v-${id}`,
    vendorName: "Vendor",
    vendorCountryCode: null,
    vendorStateCode: null,
    modelId: "m",
    materialConfigId: "mc",
    quantity: 1,
    price: 10,
    currency: "USD",
    productionTimeFast: 1,
    productionTimeSlow: 2,
    scale: 1,
    materialId: "pla",
    materialName: "PLA",
    materialGroupId: "g",
    materialGroupName: "G",
    materialImage: null,
    materialSortIndex: 1,
    finishGroupId: "fg",
    finishGroupName: "Fg",
    color: "white",
    colorCode: "#fff",
    finishGroupImage: null,
    configName: "default",
  };
}

describe("pollQuotes stability gate (CON-38)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does NOT exit on a premature allComplete:true with an empty array", async () => {
    const fetchMock = vi.fn(async () =>
      snapshotResponse({ quotes: [], shipping: [], allComplete: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    let resolved: string | null = null;
    const snapshots: number[] = [];
    const controller = new AbortController();
    const promise = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: (s) => snapshots.push(s.quotes.length),
    }).then((r) => {
      resolved = r;
      return r;
    });

    // An empty allComplete starts the stable counter immediately (count
    // 0, no growth). The loop still must NOT resolve before 4 stable
    // polls; over the first couple of cycles it stays pending and keeps
    // polling rather than exiting on the flag.
    await vi.advanceTimersByTimeAsync(1500); // poll 1
    await vi.advanceTimersByTimeAsync(1500); // poll 2
    expect(resolved).toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(snapshots.length).toBeGreaterThan(1);

    controller.abort();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await expect(promise).resolves.toBeTypeOf("string");
  });

  it("exits 'complete' only after the count is stable for 4 consecutive polls", async () => {
    const fetchMock = vi.fn(async () =>
      snapshotResponse({
        quotes: [fakeQuote("q1")],
        shipping: [],
        allComplete: true,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    let resolved: string | null = null;
    const promise = pollQuotes({
      priceId: "p1",
      signal: controller.signal,
      onSnapshot: () => {},
    }).then((r) => {
      resolved = r;
      return r;
    });

    // The first poll lands one quote (count 0 -> 1, growth) so the stable
    // counter resets — the loop has NOT met the 4-consecutive-stable
    // threshold yet and must still be pending after the initial cycle.
    await vi.advanceTimersByTimeAsync(1500);
    expect(resolved).toBeNull();
    // It also must NOT have exited after only two no-growth polls.
    await vi.advanceTimersByTimeAsync(1500);
    expect(resolved).toBeNull();

    // Drive enough additional no-growth polls to clear the threshold;
    // once stablePolls reaches STABLE_POLLS_REQUIRED the loop exits
    // 'complete'. Advancing past the requirement is safe — it can only
    // resolve once.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1500);
    }
    await promise;
    expect(resolved).toBe("complete");
  });
});
