import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock state. The route now touches many tables (MTR-33's draft-file
 * reference checks join across most FKs in the schema), so the
 * `db.select` mock dispatches on the queried table's `__name` and, for
 * the handful of tables queried MORE THAN ONCE per stale order,
 * distinguishes "first call" (the primary lookup) from "later calls"
 * (the secondary lookup) via a per-table counter. Every test in this
 * file processes at most one stale order with at most one candidate
 * draft file, so a two-slot (first-call / later-calls) model is
 * sufficient — it does not need to express arbitrary call sequences.
 *
 *   printOrders:      call 1 = the stale-order fetch (`staleOrderRows`)
 *                      call 2+ = "other order references this asset"
 *                      check inside the draft-file reference guard
 *                      (`otherPrintOrderRefs`)
 *   printOrderItems:   call 1 = this order's line items (`orderItemRows`)
 *                      call 2+ = "another order's line items reference
 *                      this asset" check (`otherPrintOrderItemRefs`)
 *   fileAssets:        call 1 = candidate asset ids -> fileId
 *                      (`assetToFileRows`)
 *                      call 2+ = a candidate file's own assets, for
 *                      both the reference check and the storage keys
 *                      to delete (`fileAssetRowsForCandidate`)
 *
 * Every other table queried by the draft-file cleanup path
 * (`files`, `projectFiles`, `collectionItems`, `filePhotos`,
 * `purchases`, `disputes`, `cadGenerations`) is queried at most once
 * per candidate file and has a single controllable variable, default
 * "no rows" (so tests that don't care about draft-file cleanup don't
 * need to configure anything).
 */
let staleOrderRows: Array<{
  id: string;
  stripeSessionId: string | null;
  fileAssetId?: string | null;
}> = [];
let cartDeleteReturns: Array<{ id: string }> = [];
let webhookDeleteReturns: Array<{ id: string }> = [];
let throwOnDelete: string | null = null;
let throwOnSelect = false;

let otherPrintOrderRefs: Array<{ id: string }> = [];
let orderItemRows: Array<{ fileAssetId: string | null }> = [];
let otherPrintOrderItemRefs: Array<{ id: string }> = [];
let assetToFileRows: Array<{ fileId: string | null }> = [];
let fileAssetRowsForCandidate: Array<{
  id: string;
  storageKey: string | null;
}> = [];
let draftFileRow: { source: string; status: string } | undefined = undefined;
let projectFileRefs: Array<{ id: string }> = [];
let collectionItemRefs: Array<{ id: string }> = [];
let filePhotoRefs: Array<{ id: string }> = [];
let purchaseRefs: Array<{ id: string }> = [];
let disputeRefs: Array<{ id: string }> = [];
let cadGenerationRefs: Array<{ id: string }> = [];

const tableCallCounts: Record<string, number> = {};

function resetTableCallCounts() {
  for (const key of Object.keys(tableCallCounts)) delete tableCallCounts[key];
}

function bumpCallCount(name: string): number {
  tableCallCounts[name] = (tableCallCounts[name] ?? 0) + 1;
  return tableCallCounts[name];
}

function selectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & {
    limit: (n: number) => unknown[];
  };
  promise.limit = (n: number) => rows.slice(0, n);
  return promise;
}

const updateCalls: Array<Record<string, unknown>> = [];
const mockRefundCreate = vi.fn();
const mockDeleteObject = vi.fn(async (_key: string) => undefined);
let filesDeleteCallCount = 0;

// The claim UPDATE (`status: 'cancelled'`) is the only UPDATE in this
// route that calls `.returning()`. Consumed FIFO; defaults to "claim
// succeeded" so every pre-existing test (none of which care about
// contention) doesn't need to configure it.
let claimReturnsQueue: Array<Array<{ id: string }>> | null = null;
function nextClaimReturn(): Array<{ id: string }> {
  if (claimReturnsQueue && claimReturnsQueue.length > 0) {
    return claimReturnsQueue.shift()!;
  }
  return [{ id: "claimed" }];
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          const name = table?.__name;
          switch (name) {
            case "printOrders": {
              const n = bumpCallCount("printOrders");
              if (n === 1) {
                if (throwOnSelect) {
                  return {
                    limit: () => {
                      throw new Error("select error");
                    },
                  };
                }
                return selectChain(staleOrderRows);
              }
              return selectChain(otherPrintOrderRefs);
            }
            case "printOrderItems": {
              const n = bumpCallCount("printOrderItems");
              return selectChain(
                n === 1 ? orderItemRows : otherPrintOrderItemRefs
              );
            }
            case "fileAssets": {
              const n = bumpCallCount("fileAssets");
              return selectChain(
                n === 1 ? assetToFileRows : fileAssetRowsForCandidate
              );
            }
            case "files":
              return selectChain(draftFileRow ? [draftFileRow] : []);
            case "projectFiles":
              return selectChain(projectFileRefs);
            case "collectionItems":
              return selectChain(collectionItemRefs);
            case "filePhotos":
              return selectChain(filePhotoRefs);
            case "purchases":
              return selectChain(purchaseRefs);
            case "disputes":
              return selectChain(disputeRefs);
            case "cadGenerations":
              return selectChain(cadGenerationRefs);
            default:
              return selectChain([]);
          }
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push(values);
          const promise = Promise.resolve() as Promise<void> & {
            returning: () => Array<{ id: string }>;
          };
          promise.returning = () => nextClaimReturn();
          return promise;
        },
      }),
    }),
    delete: (table: { __name?: string }) => ({
      where: () => {
        if (table?.__name === throwOnDelete) {
          throw new Error(`mock error for ${table?.__name}`);
        }
        if (table?.__name === "files") {
          filesDeleteCallCount++;
          return Promise.resolve();
        }
        const promise: Promise<void> & {
          returning: () => Array<{ id: string }>;
        } = Promise.resolve() as Promise<void> & {
          returning: () => Array<{ id: string }>;
        };
        promise.returning = () =>
          table?.__name === "cartItems"
            ? cartDeleteReturns
            : webhookDeleteReturns;
        return promise;
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  printOrders: {
    __name: "printOrders",
    id: "id",
    status: "status",
    createdAt: "created_at",
    stripeSessionId: "stripe_session_id",
    refundFailedAt: "refund_failed_at",
    craftCloudOrderId: "craft_cloud_order_id",
    fileAssetId: "file_asset_id",
  },
  cartItems: {
    __name: "cartItems",
    id: "id",
    updatedAt: "updated_at",
  },
  webhookEventsProcessed: {
    __name: "webhookEventsProcessed",
    id: "id",
    processedAt: "processed_at",
  },
  printOrderItems: {
    __name: "printOrderItems",
    id: "id",
    printOrderId: "print_order_id",
    fileAssetId: "file_asset_id",
  },
  fileAssets: {
    __name: "fileAssets",
    id: "id",
    fileId: "file_id",
    storageKey: "storage_key",
  },
  files: {
    __name: "files",
    id: "id",
    source: "source",
    status: "status",
  },
  projectFiles: { __name: "projectFiles", id: "id", fileId: "file_id" },
  collectionItems: {
    __name: "collectionItems",
    id: "id",
    fileId: "file_id",
  },
  filePhotos: { __name: "filePhotos", id: "id", fileId: "file_id" },
  purchases: { __name: "purchases", id: "id", fileId: "file_id" },
  disputes: { __name: "disputes", id: "id", fileId: "file_id" },
  cadGenerations: {
    __name: "cadGenerations",
    id: "id",
    fileAssetId: "file_asset_id",
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    refunds: {
      create: (...args: unknown[]) => mockRefundCreate(...args),
    },
  }),
}));

vi.mock("@/lib/storage", () => ({
  deleteObject: (key: string) => mockDeleteObject(key),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  isRedirectError: () => false,
}));

// Real drizzle-orm, except `isNull` is spy-wrapped so MTR-229's test can
// assert the stale-order SELECT excludes non-null craftCloudOrderId
// without hand-parsing the compiled SQL AST. vi.spyOn can't touch a
// live ESM export directly (module namespace isn't configurable), so
// this wraps it at mock-factory time instead.
const isNullSpy = vi.fn();
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    isNull: (...args: Parameters<typeof actual.isNull>) => {
      isNullSpy(...args);
      return actual.isNull(...args);
    },
  };
});

import { GET } from "../route";
import { logError } from "@/lib/logger";
import { printOrders } from "@/lib/db/schema";

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost/api/cron/cleanup-stale-orders", {
    headers,
  });
}

describe("cron/cleanup-stale-orders", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    staleOrderRows = [];
    cartDeleteReturns = [];
    webhookDeleteReturns = [];
    throwOnDelete = null;
    throwOnSelect = false;
    updateCalls.length = 0;
    filesDeleteCallCount = 0;
    claimReturnsQueue = null;
    otherPrintOrderRefs = [];
    orderItemRows = [];
    otherPrintOrderItemRefs = [];
    assetToFileRows = [];
    fileAssetRowsForCandidate = [];
    draftFileRow = undefined;
    projectFileRefs = [];
    collectionItemRefs = [];
    filePhotoRefs = [];
    purchaseRefs = [];
    disputeRefs = [];
    cadGenerationRefs = [];
    resetTableCallCounts();
    mockRefundCreate.mockResolvedValue({ id: "re_1" });
    mockDeleteObject.mockResolvedValue(undefined);
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-stale-orders.auth",
      expect.any(Error)
    );
  });

  it("rejects requests with the wrong token", async () => {
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-stale-orders.auth",
      expect.any(Error)
    );
  });

  it("refuses to run when CRON_SECRET is unset (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-stale-orders.auth",
      expect.any(Error)
    );
  });

  it("runs all three sweeps and reports per-task counts", async () => {
    staleOrderRows = [
      { id: "order-1", stripeSessionId: null },
      { id: "order-2", stripeSessionId: null },
    ];
    cartDeleteReturns = [{ id: "cart-1" }, { id: "cart-2" }, { id: "cart-3" }];
    webhookDeleteReturns = [{ id: "evt-1" }];

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(2);
    expect(body.deletedCartItems).toBe(3);
    expect(body.prunedWebhookEvents).toBe(1);
    expect(body.skippedContended).toBe(0);
    expect(body.deletedDraftFiles).toBe(0);
    expect(body.cutoffs).toMatchObject({
      orders: expect.any(String),
      cartItems: expect.any(String),
      webhookEvents: expect.any(String),
    });
    // Each order got a cancel update with no refundFailedAt
    const cancelledStatuses = updateCalls.filter((c) => c.status === "cancelled");
    expect(cancelledStatuses).toHaveLength(2);
  });

  it("returns 0 across the board when nothing is stale", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(0);
    expect(body.deletedCartItems).toBe(0);
    expect(body.prunedWebhookEvents).toBe(0);
    expect(body.hasMoreStaleOrders).toBe(false);
    expect(body.skippedContended).toBe(0);
    expect(body.deletedDraftFiles).toBe(0);
  });

  it("MTR-144: caps stale-order processing at STALE_ORDER_LIMIT and reports hasMoreStaleOrders", async () => {
    // 201 rows on the wire (the route fetches LIMIT+1 to detect a
    // remainder); only the first 200 should be processed.
    staleOrderRows = Array.from({ length: 201 }, (_, i) => ({
      id: `order-${i}`,
      stripeSessionId: null,
    }));

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(200);
    expect(body.hasMoreStaleOrders).toBe(true);
  });

  it("returns 500 with per-op results when cart delete fails (CON-137)", async () => {
    staleOrderRows = [{ id: "order-1", stripeSessionId: null }];
    webhookDeleteReturns = [{ id: "evt-1" }];
    throwOnDelete = "cartItems";

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(1);
    expect(body.deletedCartItems).toBe("error");
    expect(body.prunedWebhookEvents).toBe(1);
  });

  it("CON-159/MTR-229: pre-arms refundFailedAt in the claim itself, then clears it after a successful refund", async () => {
    staleOrderRows = [{ id: "order-pi", stripeSessionId: "pi_charged_123" }];

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(1);

    // Refund was issued with the PI id and idempotency key
    expect(mockRefundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_charged_123" }),
      expect.objectContaining({ idempotencyKey: "agent-cancel-refund:order-pi" })
    );

    // MTR-229 kill-window fix: the claim UPDATE itself cancels the row
    // AND pre-arms refundFailedAt, so a kill between the claim and the
    // Stripe call still leaves the row visible to retry-failed-refunds
    // (which scans isNotNull(refundFailedAt) regardless of status).
    const cancelledCall = updateCalls.find((c) => c.status === "cancelled");
    expect(cancelledCall).toBeDefined();
    expect(cancelledCall?.refundFailedAt).toBeInstanceOf(Date);

    // Once the refund actually succeeds, a follow-up write clears the
    // flag — no separate "status" key on this call, just the clear.
    const clearedCall = updateCalls.find(
      (c) => !("status" in c) && c.refundFailedAt === null
    );
    expect(clearedCall).toBeDefined();
  });

  it("CON-159: sets refundFailedAt (already pre-armed by the claim) when the refund fails, and cancels the row", async () => {
    staleOrderRows = [{ id: "order-pi", stripeSessionId: "pi_charged_123" }];
    mockRefundCreate.mockRejectedValueOnce(new Error("stripe is down"));

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(1);

    // The claim (cancel) update pre-arms refundFailedAt in the SAME
    // write — MTR-229's kill-window fix. No separate follow-up write
    // is needed on failure since the flag is already set.
    const cancelledCall = updateCalls.find((c) => c.status === "cancelled");
    expect(cancelledCall).toBeDefined();
    expect(cancelledCall?.refundFailedAt).toBeInstanceOf(Date);

    // No clearing update fired (the refund failed).
    const clearedCall = updateCalls.find(
      (c) => !("status" in c) && c.refundFailedAt === null
    );
    expect(clearedCall).toBeUndefined();

    // Error was logged
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-stale-orders.refundCharged",
      expect.any(Error)
    );
  });

  it("CON-159: non-charged rows (null stripeSessionId) are cancelled without a refund call", async () => {
    staleOrderRows = [{ id: "order-uncharged", stripeSessionId: null }];

    await GET(makeRequest("Bearer test-secret"));

    expect(mockRefundCreate).not.toHaveBeenCalled();
    const cancelledCall = updateCalls.find((c) => c.status === "cancelled");
    expect(cancelledCall).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // MTR-229: claim guard against the per-minute placement cron's re-claim
  // ---------------------------------------------------------------------

  it("MTR-229: a contended claim (another writer already moved the row) is skipped, not refunded", async () => {
    staleOrderRows = [{ id: "order-pi", stripeSessionId: "pi_charged_123" }];
    claimReturnsQueue = [[]]; // the cancel UPDATE returns zero rows

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledOrders).toBe(0);
    expect(body.skippedContended).toBe(1);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it("MTR-229: excludes rows with a craftCloudOrderId (sentinel or real) from the stale-order SELECT", async () => {
    isNullSpy.mockClear();

    await GET(makeRequest("Bearer test-secret"));

    expect(isNullSpy).toHaveBeenCalledWith(
      (printOrders as unknown as { craftCloudOrderId: unknown })
        .craftCloudOrderId
    );
  });

  // ---------------------------------------------------------------------
  // MTR-33: draft-file cleanup for cancelled anon checkouts
  // ---------------------------------------------------------------------

  it("MTR-33: an unreferenced upload-source draft file is hard-deleted along with its R2 object", async () => {
    staleOrderRows = [
      { id: "order-1", stripeSessionId: null, fileAssetId: "asset-1" },
    ];
    assetToFileRows = [{ fileId: "file-1" }];
    draftFileRow = { source: "upload", status: "draft" };
    fileAssetRowsForCandidate = [
      { id: "asset-1", storageKey: "uploads/u1/model.stl" },
    ];

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedDraftFiles).toBe(1);
    expect(filesDeleteCallCount).toBe(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("uploads/u1/model.stl");
  });

  it("MTR-33: a file referenced by a projectFiles row is NOT deleted", async () => {
    staleOrderRows = [
      { id: "order-1", stripeSessionId: null, fileAssetId: "asset-1" },
    ];
    assetToFileRows = [{ fileId: "file-1" }];
    draftFileRow = { source: "upload", status: "draft" };
    projectFileRefs = [{ id: "pf-1" }];

    const res = await GET(makeRequest("Bearer test-secret"));

    const body = await res.json();
    expect(body.deletedDraftFiles).toBe(0);
    expect(filesDeleteCallCount).toBe(0);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("MTR-33: a source='studio' draft is NOT deleted (own lifecycle/cron)", async () => {
    staleOrderRows = [
      { id: "order-1", stripeSessionId: null, fileAssetId: "asset-1" },
    ];
    assetToFileRows = [{ fileId: "file-1" }];
    draftFileRow = { source: "studio", status: "draft" };

    const res = await GET(makeRequest("Bearer test-secret"));

    const body = await res.json();
    expect(body.deletedDraftFiles).toBe(0);
    expect(filesDeleteCallCount).toBe(0);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("MTR-33: a file whose asset appears on another non-cancelled order is NOT deleted", async () => {
    staleOrderRows = [
      { id: "order-1", stripeSessionId: null, fileAssetId: "asset-1" },
    ];
    assetToFileRows = [{ fileId: "file-1" }];
    draftFileRow = { source: "upload", status: "draft" };
    fileAssetRowsForCandidate = [
      { id: "asset-1", storageKey: "uploads/u1/model.stl" },
    ];
    otherPrintOrderRefs = [{ id: "order-other" }];

    const res = await GET(makeRequest("Bearer test-secret"));

    const body = await res.json();
    expect(body.deletedDraftFiles).toBe(0);
    expect(filesDeleteCallCount).toBe(0);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("MTR-33: an R2 delete failure is logged but the sweep still succeeds", async () => {
    staleOrderRows = [
      { id: "order-1", stripeSessionId: null, fileAssetId: "asset-1" },
    ];
    assetToFileRows = [{ fileId: "file-1" }];
    draftFileRow = { source: "upload", status: "draft" };
    fileAssetRowsForCandidate = [
      { id: "asset-1", storageKey: "uploads/u1/model.stl" },
    ];
    mockDeleteObject.mockRejectedValueOnce(new Error("R2 is down"));

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    // The DB row is still deleted — the R2 object delete is best-effort.
    expect(body.deletedDraftFiles).toBe(1);
    expect(filesDeleteCallCount).toBe(1);
    expect(logError).toHaveBeenCalledWith(
      "cron/cleanup-stale-orders.deleteDraftFileObject",
      expect.any(Error)
    );
  });
});
