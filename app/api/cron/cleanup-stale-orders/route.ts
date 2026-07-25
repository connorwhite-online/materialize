import { db } from "@/lib/db";
import {
  cartItems,
  cadGenerations,
  collectionItems,
  disputes,
  fileAssets,
  files,
  filePhotos,
  printOrderItems,
  printOrders,
  projectFiles,
  purchases,
  webhookEventsProcessed,
} from "@/lib/db/schema";
import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";
import { deleteObject } from "@/lib/storage";

/**
 * Daily housekeeping sweeps. The path name predates the broader
 * scope (it began as just the stale-order cancel) — keeping it so
 * the vercel.json cron entry stays stable.
 *
 * Three independent tasks, fired in parallel:
 *
 *   1. **Stale print orders** — `cart_created` rows older than 48h
 *      get flipped to `cancelled`. They land here when the user
 *      closed the tab between createPrintOrder and completePrintOrder,
 *      when Stripe checkout never opened, or when the chain partially
 *      failed. 48h is generous: real checkouts complete in seconds
 *      and a Stripe Checkout session expires after 24h.
 *
 *      Every cancel is claimed atomically (status='cart_created' guard
 *      + `.returning()`) before anything else happens for that row —
 *      see MTR-229. This matters because the per-minute
 *      place-auto-approved-orders cron re-claims the SAME population
 *      (`status='cart_created' AND stripeSessionId LIKE 'pi_%' AND
 *      craftCloudOrderId IS NULL`, see that route's Phase 2) to retry
 *      stuck charged rows. Without the claim guard, this sweep could
 *      refund + cancel a row placement is actively placing at
 *      CraftCloud, producing an order that's both placed AND refunded.
 *      A row with ANY `craftCloudOrderId` (a `placing:` sentinel or a
 *      real CraftCloud order id — two-step orders place the CraftCloud
 *      order up-front) is excluded from the SELECT entirely for the
 *      same reason. Rows the claim loses are counted in
 *      `skippedContended`, never refunded.
 *
 *      MTR-33: once a row's cancel claim succeeds, the checkout's
 *      draft files (created by createDraftFileForPrint for anon
 *      checkouts) are hard-deleted along with their R2 object — but
 *      only when nothing else references them. See
 *      `cleanupDraftFilesForOrder` below for the full reference-check
 *      list.
 *
 *   2. **Stale cart items** — `cart_items` rows older than 7 days
 *      get hard-deleted. The `quoteId` on each is stale long before
 *      this (CraftCloud quotes age out in hours), so the user would
 *      hit a re-quote flow at checkout anyway — better to clear them
 *      proactively than render a cart full of expired numbers.
 *
 *   3. **Webhook event dedup prune** — `webhook_events_processed`
 *      rows older than 30 days get hard-deleted. Stripe stops
 *      retrying after a few days, so 30d is well past any legitimate
 *      retry window. Without pruning the table grows unboundedly.
 *
 * Auth: when Vercel cron triggers this route it includes
 * `Authorization: Bearer ${CRON_SECRET}`. Without that header (or
 * with a wrong value) we 401.
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \\
 *     http://localhost:3000/api/cron/cleanup-stale-orders
 */

const STALE_ORDER_AGE_MS = 48 * 60 * 60 * 1000;
const STALE_CART_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_DEDUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// The stale-order pass is serial (refund, then cancel, per row) and
// previously had no cap — an unbounded backlog could run past the
// function's wall-clock limit with zero signal (see MTR-144). 200 rows
// at up to ~2s/row (a Stripe refund call plus the DB update) is ~400s
// worst case, which is why maxDuration below is sized to match; any
// remainder is picked up by tomorrow's run (`hasMoreStaleOrders` in the
// response makes a growing backlog visible before it becomes a crisis).
const STALE_ORDER_LIMIT = 200;

// Worst case ~200 serial refund+cancel calls (see STALE_ORDER_LIMIT)
// at up to ~2s each ≈ 400s; 300s (the platform's default Pro-plan
// ceiling) covers the common case. A run that hits the ceiling still
// leaves partial progress — every write is per-row and unconditional
// only after its own refund attempt completes — so a mid-sweep kill
// just means more rows for tomorrow, not a double-refund.
export const maxDuration = 300;

/**
 * MTR-33: true when the file is a checkout draft (`source='upload'`,
 * `status='draft'`) with no reference OTHER than the order we're
 * cancelling — checked against every fileId/fileAssetId FK in the
 * schema at plan time (projectFiles, collectionItems, filePhotos,
 * purchases, disputes on `files.id`; printOrders, printOrderItems,
 * cadGenerations on the file's `fileAssets.id`).
 */
async function isDraftDeletionCandidate(fileId: string): Promise<boolean> {
  const [file] = await db
    .select({ source: files.source, status: files.status })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);
  if (!file || file.source !== "upload" || file.status !== "draft") {
    return false;
  }

  const [projectRef, collectionRef, photoRef, purchaseRef, disputeRef] =
    await Promise.all([
      db
        .select({ id: projectFiles.id })
        .from(projectFiles)
        .where(eq(projectFiles.fileId, fileId))
        .limit(1),
      db
        .select({ id: collectionItems.id })
        .from(collectionItems)
        .where(eq(collectionItems.fileId, fileId))
        .limit(1),
      db
        .select({ id: filePhotos.id })
        .from(filePhotos)
        .where(eq(filePhotos.fileId, fileId))
        .limit(1),
      db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.fileId, fileId))
        .limit(1),
      db
        .select({ id: disputes.id })
        .from(disputes)
        .where(eq(disputes.fileId, fileId))
        .limit(1),
    ]);

  return (
    projectRef.length === 0 &&
    collectionRef.length === 0 &&
    photoRef.length === 0 &&
    purchaseRef.length === 0 &&
    disputeRef.length === 0
  );
}

/**
 * Deletes one draft file (and its R2 object) IFF it is still an
 * unreferenced upload-source draft. Returns whether it was deleted.
 * R2 failures are best-effort — logged, never thrown — so a storage
 * blip can't fail the whole sweep (the DB row is already gone at that
 * point; a leftover R2 object is a much smaller problem).
 */
async function deleteUnreferencedDraftFile(
  fileId: string,
  orderId: string
): Promise<boolean> {
  const isCandidate = await isDraftDeletionCandidate(fileId);
  if (!isCandidate) return false;

  const assetRows = await db
    .select({ id: fileAssets.id, storageKey: fileAssets.storageKey })
    .from(fileAssets)
    .where(eq(fileAssets.fileId, fileId));
  const assetIds = assetRows.map((a) => a.id);

  if (assetIds.length > 0) {
    const [otherOrderRef, otherItemRef, cadRef] = await Promise.all([
      db
        .select({ id: printOrders.id })
        .from(printOrders)
        .where(
          and(
            inArray(printOrders.fileAssetId, assetIds),
            ne(printOrders.id, orderId),
            ne(printOrders.status, "cancelled")
          )
        )
        .limit(1),
      db
        .select({ id: printOrderItems.id })
        .from(printOrderItems)
        .where(
          and(
            inArray(printOrderItems.fileAssetId, assetIds),
            ne(printOrderItems.printOrderId, orderId)
          )
        )
        .limit(1),
      db
        .select({ id: cadGenerations.id })
        .from(cadGenerations)
        .where(inArray(cadGenerations.fileAssetId, assetIds))
        .limit(1),
    ]);
    if (
      otherOrderRef.length > 0 ||
      otherItemRef.length > 0 ||
      cadRef.length > 0
    ) {
      return false;
    }
  }

  // fileAssets cascade on the files delete.
  await db.delete(files).where(eq(files.id, fileId));

  for (const asset of assetRows) {
    if (!asset.storageKey) continue;
    try {
      await deleteObject(asset.storageKey);
    } catch (err) {
      logError("cron/cleanup-stale-orders.deleteDraftFileObject", err);
    }
  }

  return true;
}

/**
 * Resolves an order's draft-file candidates (its own `fileAssetId`
 * plus, for multi-item orders, every `printOrderItems.fileAssetId`
 * row) and deletes each one that's still an unreferenced upload
 * draft. Returns the number deleted. Every step is best-effort per
 * candidate — one bad row logs and moves on rather than aborting the
 * rest of the order's cleanup.
 */
async function cleanupDraftFilesForOrder(order: {
  id: string;
  fileAssetId: string | null;
}): Promise<number> {
  const itemAssetRows = await db
    .select({ fileAssetId: printOrderItems.fileAssetId })
    .from(printOrderItems)
    .where(eq(printOrderItems.printOrderId, order.id));

  const candidateAssetIds = [
    ...(order.fileAssetId ? [order.fileAssetId] : []),
    ...itemAssetRows
      .map((r) => r.fileAssetId)
      .filter((id): id is string => !!id),
  ];
  if (candidateAssetIds.length === 0) return 0;

  const assetFileRows = await db
    .select({ fileId: fileAssets.fileId })
    .from(fileAssets)
    .where(inArray(fileAssets.id, candidateAssetIds));

  const candidateFileIds = [
    ...new Set(
      assetFileRows.map((r) => r.fileId).filter((id): id is string => !!id)
    ),
  ];

  let deleted = 0;
  for (const fileId of candidateFileIds) {
    try {
      const wasDeleted = await deleteUnreferencedDraftFile(fileId, order.id);
      if (wasDeleted) deleted++;
    } catch (err) {
      logError("cron/cleanup-stale-orders.deleteDraftFiles", err);
    }
  }
  return deleted;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logError(
      "cron/cleanup-stale-orders.auth",
      new Error("CRON_SECRET not configured")
    );
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    logError(
      "cron/cleanup-stale-orders.auth",
      new Error("Unauthorized cron request")
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = Date.now();
    const orderCutoff = new Date(now - STALE_ORDER_AGE_MS);
    const cartCutoff = new Date(now - STALE_CART_AGE_MS);
    const webhookCutoff = new Date(now - WEBHOOK_DEDUP_RETENTION_MS);

    type OpResult = number | "error";
    let cancelledOrders: OpResult = "error";
    let deletedCartItems: OpResult = "error";
    let prunedWebhookEvents: OpResult = "error";
    let hasMoreStaleOrders = false;
    let skippedContended = 0;
    let deletedDraftFiles = 0;

    try {
      // CON-159: Rows with a `pi_`-prefixed stripeSessionId are
      // off-session auto-approved orders where the customer was already
      // charged. Cancel them only after attempting a refund so we never
      // silently abandon a charged-but-unplaced order.
      //
      // MTR-229: excludes rows with ANY craftCloudOrderId (sentinel or
      // real) — those are being actively placed or were placed
      // up-front (two-step) and must never be swept here.
      //
      // Fetch one row past the cap so we can tell whether there's a
      // remainder without a separate COUNT query.
      const fetchedRows = await db
        .select({
          id: printOrders.id,
          stripeSessionId: printOrders.stripeSessionId,
          fileAssetId: printOrders.fileAssetId,
        })
        .from(printOrders)
        .where(
          and(
            eq(printOrders.status, "cart_created"),
            lt(printOrders.createdAt, orderCutoff),
            isNull(printOrders.craftCloudOrderId)
          )
        )
        .limit(STALE_ORDER_LIMIT + 1);

      hasMoreStaleOrders = fetchedRows.length > STALE_ORDER_LIMIT;
      const staleRows = hasMoreStaleOrders
        ? fetchedRows.slice(0, STALE_ORDER_LIMIT)
        : fetchedRows;

      const stripe = getStripe();
      let cancelled = 0;

      for (const row of staleRows) {
        const isChargedRow =
          typeof row.stripeSessionId === "string" &&
          row.stripeSessionId.startsWith("pi_");

        // MTR-229: claim the row atomically before doing anything
        // else. A zero-row result means another writer (the per-minute
        // placement cron reclaiming a stuck charged row, an overlapping
        // invocation of this same sweep, etc.) already moved the row
        // off cart_created — skip it entirely, and critically, never
        // issue a refund for it.
        const claimedRows = await db
          .update(printOrders)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(printOrders.id, row.id),
              eq(printOrders.status, "cart_created")
            )
          )
          .returning({ id: printOrders.id });

        if (claimedRows.length === 0) {
          skippedContended++;
          continue;
        }

        if (isChargedRow) {
          // The order was charged via off-session PI but never placed.
          // The claim above already cancelled it; now issue the
          // refund. On refund failure, set refundFailedAt so
          // retry-failed-refunds picks it up.
          try {
            await stripe.refunds.create(
              {
                payment_intent: row.stripeSessionId!,
                reason: "requested_by_customer",
                metadata: {
                  printOrderId: row.id,
                  source: "cleanup_stale_charged",
                },
              },
              { idempotencyKey: `agent-cancel-refund:${row.id}` }
            );
          } catch (refundErr) {
            logError("cron/cleanup-stale-orders.refundCharged", refundErr);
            await db
              .update(printOrders)
              .set({ refundFailedAt: new Date() })
              .where(eq(printOrders.id, row.id));
          }
        }

        cancelled++;

        // MTR-33: the order is cancelled either way at this point —
        // its draft files (if any) are now orphaned. Best-effort;
        // never let a draft-file cleanup failure fail the sweep.
        try {
          deletedDraftFiles += await cleanupDraftFilesForOrder(row);
        } catch (err) {
          logError("cron/cleanup-stale-orders.deleteDraftFiles", err);
        }
      }

      cancelledOrders = cancelled;
    } catch (err) {
      logError("cron/cleanup-stale-orders.cancelOrders", err);
    }

    try {
      const rows = await db
        .delete(cartItems)
        .where(lt(cartItems.updatedAt, cartCutoff))
        .returning({ id: cartItems.id });
      deletedCartItems = rows.length;
    } catch (err) {
      logError("cron/cleanup-stale-orders.deleteCartItems", err);
    }

    try {
      const rows = await db
        .delete(webhookEventsProcessed)
        .where(lt(webhookEventsProcessed.processedAt, webhookCutoff))
        .returning({ id: webhookEventsProcessed.id });
      prunedWebhookEvents = rows.length;
    } catch (err) {
      logError("cron/cleanup-stale-orders.pruneWebhookEvents", err);
    }

    const anyFailed =
      cancelledOrders === "error" ||
      deletedCartItems === "error" ||
      prunedWebhookEvents === "error";

    const result = {
      cancelledOrders,
      deletedCartItems,
      prunedWebhookEvents: prunedWebhookEvents,
      hasMoreStaleOrders,
      skippedContended,
      deletedDraftFiles,
      cutoffs: {
        orders: orderCutoff.toISOString(),
        cartItems: cartCutoff.toISOString(),
        webhookEvents: webhookCutoff.toISOString(),
      },
    };
    console.log("[cron/cleanup-stale-orders] swept", result);

    if (anyFailed) {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result);
  } catch (error) {
    logError("cron/cleanup-stale-orders", error);
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
