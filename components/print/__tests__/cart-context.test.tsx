// @vitest-environment jsdom
//
// components/print/cart-context.tsx is mocked out entirely in the only
// other test that touches it (quote-configurator.test.tsx stubs
// useCart), so two load-bearing contracts had zero direct coverage
// (MTR-154):
//
//   1. materializeLocalItems (:302-396) — the presign -> R2 -> draft ->
//      addToCart drain with per-item dequeue and the materializingRef
//      reentry guard. A partial failure must not re-upload items that
//      already landed in the DB cart on retry.
//   2. updateQuantity (:200-291) — the repriceAbortRef cancel-and-
//      replace race guard and the "no match / persist failure ->
//      REJECT the change and revert the optimistic quantity" path
//      (MONEY-1 — a silent fallback quantity write here used to desync
//      cartItems.quantity from the still-old-quantity quoteId).
//
// Model: components/print/__tests__/run-anon-checkout.test.ts (mocks
// fetch for presign/R2, mocks server actions).
//
// NOTE(MTR-133): the reprice-race fix ("clear the repricing indicator
// only for the live request") is a separate, not-yet-merged PR that
// changes updateQuantity's finally-block. Per that issue's plan, the
// indicator-liveness assertion below is left as `it.todo` referencing
// MTR-133 instead of pinning today's (about-to-change) behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { EnrichedQuote } from "../material-picker/types";

const getCartImpl = vi.fn(async (..._args: unknown[]) => ({
  items: [] as unknown[],
}));
const addToCartImpl = vi.fn(
  async (..._args: unknown[]) => ({ cartItemId: "ci-new" }) as unknown
);
const removeFromCartImpl = vi.fn(async (..._args: unknown[]) => ({
  success: true as const,
}));
const updateCartItemQuantityImpl = vi.fn(
  async (..._args: unknown[]) => ({ success: true as const }) as unknown
);
const repriceCartItemImpl = vi.fn(
  async (..._args: unknown[]) => ({ success: true as const }) as unknown
);
const getCartItemCountImpl = vi.fn(async (..._args: unknown[]) => 0);

vi.mock("@/app/actions/cart", () => ({
  getCart: (...args: unknown[]) => getCartImpl(...args),
  addToCart: (...args: unknown[]) => addToCartImpl(...args),
  removeFromCart: (...args: unknown[]) => removeFromCartImpl(...args),
  updateCartItemQuantity: (...args: unknown[]) =>
    updateCartItemQuantityImpl(...args),
  repriceCartItem: (...args: unknown[]) => repriceCartItemImpl(...args),
  getCartItemCount: (...args: unknown[]) => getCartItemCountImpl(...args),
}));

const draftImpl = vi.fn(async (p: { originalFilename: string }) => ({
  fileAssetId: `asset-${p.originalFilename}`,
}));
vi.mock("@/app/actions/files", () => ({
  createDraftFileForPrint: (p: unknown) => draftImpl(p as never),
}));

const reportClientErrorImpl = vi.fn();
vi.mock("@/lib/observability/report-client-error", () => ({
  reportClientError: (...args: unknown[]) => reportClientErrorImpl(...args),
}));

type PollOpts = {
  priceId: string;
  signal: AbortSignal;
  onSnapshot: (s: {
    quotes: EnrichedQuote[];
    shipping: unknown[];
    allComplete: boolean;
  }) => void;
};
let pollCalls: PollOpts[] = [];
// Default: resolves immediately with an empty, "complete" snapshot —
// tests override via pollQuotesImpl for match/no-match scenarios.
let pollQuotesImpl: (opts: PollOpts) => Promise<string> = async (opts) => {
  pollCalls.push(opts);
  opts.onSnapshot({ quotes: [], shipping: [], allComplete: true });
  return opts.signal.aborted ? "aborted" : "complete";
};
const mockPollQuotes = vi.fn((opts: PollOpts) => pollQuotesImpl(opts));
vi.mock("@/components/print/poll-quotes", () => ({
  pollQuotes: (opts: PollOpts) => mockPollQuotes(opts),
}));

import { CartProvider, useCart, type LocalCartItem } from "../cart-context";

function makeFile(name: string): File {
  return new File(["hello world"], name, {
    type: "application/octet-stream",
  });
}

function localItemParams(
  overrides: Partial<Omit<LocalCartItem, "localId">> = {}
): Omit<LocalCartItem, "localId"> {
  const originalFilename = overrides.originalFilename ?? "part.stl";
  return {
    file: makeFile(originalFilename),
    modelId: "model-1",
    originalFilename,
    vendorId: "vendor-1",
    vendorName: "Unionfab",
    materialConfigId: "pla-white",
    shippingId: "ship-1",
    priceId: "price-1",
    quoteId: "quote-1",
    quantity: 1,
    materialPrice: 10,
    shippingPrice: 5,
    currency: "USD",
    countryCode: "US",
    ...overrides,
  };
}

function makeQuote(overrides: Partial<EnrichedQuote> = {}): EnrichedQuote {
  return {
    quoteId: "quote-2",
    vendorId: "vendor-1",
    vendorName: "Unionfab",
    vendorCountryCode: "US",
    vendorStateCode: null,
    modelId: "model-1",
    materialConfigId: "pla-white",
    printingMethodId: null,
    quantity: 3,
    price: 12.5,
    currency: "USD",
    productionTimeFast: 2,
    productionTimeSlow: 5,
    scale: 1,
    materialId: "mat-1",
    materialName: "PLA",
    materialGroupId: "grp-1",
    materialGroupName: "PLA",
    materialImage: null,
    materialSortIndex: 0,
    finishGroupId: "fg-1",
    finishGroupName: "Standard",
    finishGroupImage: null,
    color: "White",
    colorCode: "#ffffff",
    configName: "PLA White",
    ...overrides,
  };
}

function mockFetchRouter() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const href = typeof url === "string" ? url : (url as Request).url;
    if (href.includes("/api/upload/presign")) {
      const body = init?.body
        ? (JSON.parse(init.body as string) as { filename: string })
        : { filename: "unknown" };
      return new Response(
        JSON.stringify({
          uploadUrl: `https://r2.example/${body.filename}`,
          storageKey: `uploads/test-user/${body.filename}`,
          format: "stl",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (href.includes("/api/craftcloud/quotes")) {
      return new Response(JSON.stringify({ priceId: "price-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // R2 PUT (or anything else) — succeed.
    return new Response(null, { status: 200 });
  });
}

const baseCartItem = {
  id: "ci-1",
  fileAssetId: "asset-1",
  fileName: "Carabiner",
  originalFilename: "carabiner.stl",
  vendorId: "vendor-1",
  vendorName: "Unionfab",
  materialConfigId: "pla-white",
  shippingId: "ship-1",
  quoteId: "quote-1",
  quantity: 1,
  materialPrice: 1000, // cents
  shippingPrice: 500, // cents
  currency: "USD",
  countryCode: "US",
  updatedAt: new Date().toISOString(),
};

describe("cart-context: materializeLocalItems (anon queue-drain)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getCartImpl.mockResolvedValue({ items: [] });
    getCartItemCountImpl.mockResolvedValue(0);
    pollQuotesImpl = async (opts) => {
      pollCalls.push(opts);
      opts.onSnapshot({ quotes: [], shipping: [], allComplete: true });
      return "complete";
    };
    pollCalls = [];
  });

  it("a mid-queue failure removes already-materialized items and leaves the failing one queued for retry", async () => {
    mockFetchRouter();
    addToCartImpl
      .mockResolvedValueOnce({ cartItemId: "ci-1" }) // item 1 succeeds
      .mockResolvedValueOnce({ error: "insert failed" }); // item 2 fails

    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });

    act(() => {
      result.current!.addLocalItem(
        localItemParams({ originalFilename: "part-1.stl" })
      );
      result.current!.addLocalItem(
        localItemParams({ originalFilename: "part-2.stl" })
      );
    });
    expect(result.current!.localItems).toHaveLength(2);

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current!.materializeLocalItems();
    });

    expect(outcome).toEqual({ ok: false, error: "insert failed" });
    // item 1 already landed in the DB cart and was dequeued; item 2
    // (the failure) stays in localItems for a retry.
    expect(result.current!.localItems).toHaveLength(1);
    expect(result.current!.localItems[0].originalFilename).toBe(
      "part-2.stl"
    );
    expect(draftImpl).toHaveBeenCalledTimes(2);
    expect(addToCartImpl).toHaveBeenCalledTimes(2);

    // Retry: only the still-queued item is re-uploaded. item 1 must
    // NOT be re-presigned/re-drafted/re-added — that would duplicate
    // it in the DB cart.
    addToCartImpl.mockResolvedValueOnce({ cartItemId: "ci-2" });
    await act(async () => {
      outcome = await result.current!.materializeLocalItems();
    });

    expect(outcome).toEqual({ ok: true });
    expect(result.current!.localItems).toHaveLength(0);
    expect(draftImpl).toHaveBeenCalledTimes(3); // 2 initial + 1 retry
    expect(addToCartImpl).toHaveBeenCalledTimes(3);
    expect(draftImpl.mock.calls[2][0]).toMatchObject({
      originalFilename: "part-2.stl",
    });
  });

  it("materializingRef rejects a concurrent call while one is already in flight", async () => {
    mockFetchRouter();
    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });
    act(() => {
      result.current!.addLocalItem(
        localItemParams({ originalFilename: "part-1.stl" })
      );
    });

    // The first call sets materializingRef synchronously (before its
    // first await), so a second call issued right after — even without
    // yielding to the microtask queue — must see the guard.
    let firstCallPromise!: Promise<{ ok: boolean; error?: string }>;
    act(() => {
      firstCallPromise = result.current!.materializeLocalItems();
    });

    let secondResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      secondResult = await result.current!.materializeLocalItems();
    });

    expect(secondResult).toEqual({
      ok: false,
      error: "Already preparing cart — please wait",
    });

    await act(async () => {
      await firstCallPromise;
    });
  });

  it("calls refresh() (re-fetches the DB cart) only when every item materializes successfully", async () => {
    mockFetchRouter();
    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });

    // Failure case first — refresh must NOT fire.
    addToCartImpl.mockResolvedValueOnce({ error: "boom" });
    act(() => {
      result.current!.addLocalItem(
        localItemParams({ originalFilename: "part-1.stl" })
      );
    });
    await act(async () => {
      await result.current!.materializeLocalItems();
    });
    expect(getCartImpl).not.toHaveBeenCalled();

    // Now the (retried) queue succeeds — refresh must fire exactly once.
    addToCartImpl.mockResolvedValueOnce({ cartItemId: "ci-1" });
    await act(async () => {
      await result.current!.materializeLocalItems();
    });
    expect(getCartImpl).toHaveBeenCalledTimes(1);
  });

  it("returns { ok: true } as a no-op when there are no local items to materialize", async () => {
    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current!.materializeLocalItems();
    });

    expect(outcome).toEqual({ ok: true });
    expect(draftImpl).not.toHaveBeenCalled();
    expect(getCartImpl).not.toHaveBeenCalled();
  });
});

describe("cart-context: updateQuantity re-pricing", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockFetchRouter();
    getCartItemCountImpl.mockResolvedValue(0);
    pollCalls = [];
    pollQuotesImpl = async (opts) => {
      pollCalls.push(opts);
      opts.onSnapshot({ quotes: [], shipping: [], allComplete: true });
      return opts.signal.aborted ? "aborted" : "complete";
    };
  });

  async function seedOneItem() {
    getCartImpl.mockResolvedValueOnce({ items: [baseCartItem] });
    const { result } = renderHook(() => useCart(), { wrapper: CartProvider });
    await act(async () => {
      await result.current!.refresh();
    });
    expect(result.current!.items).toHaveLength(1);
    return result;
  }

  it("a matching quote persists via repriceCartItem and updates quoteId + materialPrice", async () => {
    pollQuotesImpl = async (opts) => {
      pollCalls.push(opts);
      opts.onSnapshot({
        quotes: [makeQuote({ price: 12.5, quoteId: "quote-2" })],
        shipping: [],
        allComplete: true,
      });
      return "complete";
    };
    repriceCartItemImpl.mockResolvedValueOnce({ success: true });

    const result = await seedOneItem();

    await act(async () => {
      await result.current!.updateQuantity("ci-1", 3);
    });

    expect(repriceCartItemImpl).toHaveBeenCalledWith({
      cartItemId: "ci-1",
      quantity: 3,
      quoteId: "quote-2",
      materialPrice: 12.5,
    });
    expect(updateCartItemQuantityImpl).not.toHaveBeenCalled();

    const updated = result.current!.items.find((i) => i.id === "ci-1");
    expect(updated?.quantity).toBe(3);
    expect(updated?.quoteId).toBe("quote-2");
    expect(updated?.materialPrice).toBe(1250); // cents
  });

  // MONEY-1: a re-quote failure must REJECT the quantity change rather
  // than silently persist a quantity that no longer matches the
  // line's baked-in quoteId (checkoutVendorGroup bills
  // `quantity * price` while CraftCloud produces whatever the
  // quoteId itself encodes — a silent fallback write desyncs them).
  // `updateCartItemQuantity` must never be called from this path
  // anymore; the optimistic quantity bump must be reverted.
  it("rejects the quantity change (reverting the optimistic bump) when no quote matches the item's vendor/material", async () => {
    pollQuotesImpl = async (opts) => {
      pollCalls.push(opts);
      opts.onSnapshot({
        // Different vendor — no match against baseCartItem's vendor-1.
        quotes: [makeQuote({ vendorId: "vendor-OTHER", quoteId: "quote-99" })],
        shipping: [],
        allComplete: true,
      });
      return "complete";
    };

    const result = await seedOneItem();

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current!.updateQuantity("ci-1", 4);
    });

    expect(outcome?.ok).toBe(false);
    expect(repriceCartItemImpl).not.toHaveBeenCalled();
    expect(updateCartItemQuantityImpl).not.toHaveBeenCalled();
    // Reverted to the pre-change (DB-confirmed) quantity, not left at
    // the optimistically-bumped 4.
    const item = result.current!.items.find((i) => i.id === "ci-1");
    expect(item?.quantity).toBe(baseCartItem.quantity);
  });

  it("rejects the quantity change (reverting the optimistic bump) when repriceCartItem persist fails despite a matching quote", async () => {
    pollQuotesImpl = async (opts) => {
      pollCalls.push(opts);
      opts.onSnapshot({
        quotes: [makeQuote({ quoteId: "quote-2" })],
        shipping: [],
        allComplete: true,
      });
      return "complete";
    };
    repriceCartItemImpl.mockResolvedValueOnce({ error: "db write failed" });

    const result = await seedOneItem();

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current!.updateQuantity("ci-1", 2);
    });

    expect(outcome).toEqual({ ok: false, error: "db write failed" });
    expect(repriceCartItemImpl).toHaveBeenCalled();
    expect(updateCartItemQuantityImpl).not.toHaveBeenCalled();
    const item = result.current!.items.find((i) => i.id === "ci-1");
    expect(item?.quantity).toBe(baseCartItem.quantity);
  });

  it("a rapid second call aborts the first in-flight pollQuotes via its own AbortSignal", async () => {
    const result = await seedOneItem();

    let pA!: Promise<{ ok: boolean; error?: string }>;
    let pB!: Promise<{ ok: boolean; error?: string }>;
    await act(async () => {
      // Fired back-to-back, synchronously, mirroring a user clicking
      // +1 twice quickly before the first re-quote lands.
      pA = result.current!.updateQuantity("ci-1", 2);
      pB = result.current!.updateQuantity("ci-1", 3);
      await Promise.all([pA, pB]);
    });

    expect(pollCalls.length).toBeGreaterThanOrEqual(2);
    const [firstCall, secondCall] = pollCalls;
    // The first call's controller was aborted by the second call
    // (repriceAbortRef cancel-and-replace) — its signal must reflect
    // that by the time pollQuotes observed it.
    expect(firstCall.signal.aborted).toBe(true);
    expect(secondCall.signal.aborted).toBe(false);
  });

  // MTR-133 (in-flight PR, not yet merged in this branch) fixes
  // updateQuantity's finally-block so setRepricing(id, false) only
  // fires for the LIVE (most-recent) request — today, the stale
  // request's own finally-block unconditionally clears the indicator
  // even while a newer request for the same id is still in flight,
  // which can flash the price skeleton off prematurely. Once MTR-133
  // lands, replace this with a real assertion that repricingIds still
  // contains the id after the stale call's cleanup runs, and only
  // clears once the live call finishes.
  it.todo(
    "the repricing indicator is cleared only for the live request, not a superseded one (MTR-133)"
  );
});
