import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import Stripe from "stripe";
import { db } from "@/lib/db";
import {
  fileAssets,
  files,
  personalAccessTokens,
  printOrders,
  printOrderItems,
  tokenSpendingLedger,
  users,
} from "@/lib/db/schema";
import { createCart, getPrice, CraftCloudApiError } from "@/lib/craftcloud/client";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { evaluateSpendingPolicy } from "@/lib/billing/policy";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";
import type { Currency } from "@/lib/craftcloud/types";
import { calcServiceFee } from "@/lib/fees";

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

const QUOTE_EXPIRED_ERROR =
  "This quote has expired. Re-run materialize_get_quote and try again.";

// Rounding-only tolerance — see the identical constant + rationale in
// app/actions/print.ts (duplicated rather than extracted into a
// shared helper; MTR-162 tracks that extraction as a deliberate
// follow-up AFTER this money-critical change lands). MTR-130.
const PRICE_RECONCILE_TOLERANCE_CENTS = 1;

/**
 * Re-derive the authoritative per-unit material price for a quote
 * from CraftCloud instead of trusting the agent-supplied
 * materialPriceCents. Worst-case exposure on this path: an
 * off-session auto-charge with nobody present to notice a tampered
 * total, so this is not optional. See app/actions/print.ts's twin for
 * the full rationale — kept in sync there.
 */
async function reconcileMaterialPrice(params: {
  priceId: string;
  quoteId: string;
  claimedPriceCents: number;
}): Promise<{ ok: true; priceCents: number } | { ok: false; error: string }> {
  let snapshot;
  try {
    snapshot = await getPrice(params.priceId);
  } catch (error) {
    if (error instanceof CraftCloudApiError && error.isQuoteExpired()) {
      return { ok: false, error: QUOTE_EXPIRED_ERROR };
    }
    throw error;
  }

  const quote = snapshot.quotes?.find((q) => q.quoteId === params.quoteId);
  if (!quote) {
    return { ok: false, error: QUOTE_EXPIRED_ERROR };
  }

  const authoritativeCents = Math.round(quote.price * 100);
  if (
    Math.abs(authoritativeCents - params.claimedPriceCents) >
    PRICE_RECONCILE_TOLERANCE_CENTS
  ) {
    return {
      ok: false,
      error:
        "Pricing has changed since this quote was generated. Re-run materialize_get_quote and try again.",
    };
  }

  return { ok: true, priceCents: authoritativeCents };
}

/**
 * Kill switch for the auto-approve flow. Default-off so deploying
 * this code is a no-op until the flag is flipped per-environment.
 * When false, every order falls through to the existing email-
 * confirm path regardless of token policy.
 */
function isAgentBillingEnabled(): boolean {
  return process.env.MATERIALIZE_AGENT_BILLING_ENABLED === "true";
}

export interface CreateAgentOrderInput {
  userId: string;
  initiatedByTokenId: string;
  agentName: string;
  idempotencyKey: string;
  fileAssetId: string;
  // CraftCloud priceId the quoteId was resolved from (returned
  // alongside every quote by getQuoteForUser / materialize_get_quote)
  // — lets the server re-derive the authoritative per-unit price via
  // getPrice() instead of trusting the agent-supplied
  // materialPriceCents (MTR-130).
  priceId: string;
  quoteId: string;
  vendorId: string;
  vendorName?: string;
  materialConfigId: string;
  shippingId: string;
  quantity: number;
  materialPriceCents: number;
  shippingPriceCents: number;
  currency: Currency;
  shippingAddress: {
    email: string;
    firstName: string;
    lastName: string;
    address: string;
    addressLine2?: string;
    city: string;
    zipCode: string;
    stateCode?: string;
    countryCode: string;
    phoneNumber?: string;
  };
}

export interface CreateAgentOrderResult {
  orderId: string;
  /**
   * `auto_approved` — order was charged via off-session PaymentIntent
   * because the token's spending policy permitted it. The user has
   * a brief cancellation window before the CraftCloud order is
   * placed. `awaiting_user_approval` — order is parked, the user
   * gets an email with a confirmation link to mint a Checkout
   * session and pay (today's behavior).
   */
  path: "auto_approved" | "awaiting_user_approval";
  confirmationToken: string;
  confirmationExpiresAt: string;
  totalPriceCents: number;
  serviceFeeCents: number;
  /**
   * Set on auto-approved orders. Until this timestamp, the
   * CraftCloud-placement step is held so the user can still cancel.
   */
  cancellationDeadline?: string;
  /**
   * Remaining cents in the token's current period budget AFTER
   * this order. Useful for the agent's decision-making on the
   * next order.
   */
  remainingPeriodBudgetCents?: number;
  /**
   * Set when the order fell back to confirm-by-email even though a
   * policy is configured (out of budget, card declined, etc.). The
   * MCP tool surfaces this to the agent so it can explain to the
   * user.
   */
  fallbackReason?: string;
}

export async function createAgentInitiatedOrder(
  input: CreateAgentOrderInput
): Promise<CreateAgentOrderResult | { error: string }> {
  const [existing] = await db
    .select({
      id: printOrders.id,
      confirmationToken: printOrders.confirmationToken,
      confirmationExpiresAt: printOrders.confirmationExpiresAt,
      autoApprovedUntil: printOrders.autoApprovedUntil,
      totalPrice: printOrders.totalPrice,
      serviceFee: printOrders.serviceFee,
      status: printOrders.status,
    })
    .from(printOrders)
    .where(
      and(
        eq(printOrders.userId, input.userId),
        eq(printOrders.agentIdempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existing) {
    // The replay applies whether the original order is still
    // awaiting confirmation OR was auto-approved within the
    // cancellation window — both are pre-fulfillment states the
    // agent can safely re-poll. Anything past the cancellation
    // window has been (or is being) placed; reuse is unsafe there.
    const replayable =
      existing.status === "awaiting_agent_approval" ||
      (existing.status === "auto_approved" &&
        existing.autoApprovedUntil != null &&
        existing.autoApprovedUntil.getTime() > Date.now());
    if (!replayable) {
      return {
        error:
          "Idempotency key was used for an order that has already started fulfillment",
      };
    }
    return {
      orderId: existing.id,
      path:
        existing.status === "auto_approved"
          ? "auto_approved"
          : "awaiting_user_approval",
      confirmationToken: existing.confirmationToken ?? "",
      confirmationExpiresAt:
        existing.confirmationExpiresAt?.toISOString() ?? "",
      cancellationDeadline:
        existing.autoApprovedUntil?.toISOString() ?? undefined,
      totalPriceCents: existing.totalPrice,
      serviceFeeCents: existing.serviceFee,
    };
  }

  const [assetRow] = await db
    .select({
      assetId: fileAssets.id,
      ownerId: files.userId,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, input.fileAssetId))
    .limit(1);

  if (!assetRow) return { error: "File not found" };
  if (assetRow.ownerId !== input.userId) {
    return { error: "Forbidden: file does not belong to this user" };
  }

  // Re-derive the authoritative per-unit price from CraftCloud instead
  // of trusting the agent-supplied materialPriceCents — this is the
  // highest-risk path for tampering (uncapped revenue leakage on the
  // auto-approved off-session charge, with no human present to notice
  // a mismatched total). MTR-130.
  const materialReconciled = await reconcileMaterialPrice({
    priceId: input.priceId,
    quoteId: input.quoteId,
    claimedPriceCents: input.materialPriceCents,
  });
  if (!materialReconciled.ok) return { error: materialReconciled.error };
  const materialPriceCents = materialReconciled.priceCents;

  let cartId: string;
  let productionFeeCents = 0;
  try {
    const cart = await createCart({
      shippingIds: [input.shippingId],
      currency: input.currency,
      quotes: [{ id: input.quoteId }],
    });
    cartId = cart.cartId;
    const minimum = cart.minimumProductionPrice?.[input.vendorId];
    productionFeeCents = Math.round((minimum?.productionFee ?? 0) * 100);
  } catch (error) {
    logError("createAgentInitiatedOrder.createCart", error);
    if (error instanceof CraftCloudApiError && error.isQuoteExpired()) {
      return { error: "Quote has expired. Re-run get_quote and try again." };
    }
    return { error: "Failed to reserve cart with the print vendor" };
  }

  const preShippingTotal =
    materialPriceCents * input.quantity + productionFeeCents;
  const totalPrice = preShippingTotal + input.shippingPriceCents;
  const serviceFee = calcServiceFee(preShippingTotal);
  // What the user will actually be charged — service fee on top of
  // the line items. Keep this consistent with mintStripeSession in
  // app/actions/agent-orders.ts so the auto-approved charge equals
  // the email-confirm charge for the same order shape.
  const grandTotalCents = totalPrice + serviceFee;

  const confirmationToken = nanoid(32);
  const confirmationExpiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);

  // Look up the policy + payment method in parallel so we only pay
  // the round-trip cost once. Both queries are tiny PK lookups.
  const [policyRow, billingRow] = await Promise.all([
    db
      .select({ spendingPolicy: personalAccessTokens.spendingPolicy })
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, input.initiatedByTokenId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        stripeCustomerId: users.stripeCustomerId,
        defaultPaymentMethod: users.defaultPaymentMethod,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const evaluation = await evaluateSpendingPolicy({
    policy: policyRow?.spendingPolicy ?? null,
    tokenId: input.initiatedByTokenId,
    orderTotalCents: grandTotalCents,
    vendorId: input.vendorId,
    materialId: input.materialConfigId,
    hasPaymentMethod: !!billingRow?.defaultPaymentMethod,
  });

  let path: "auto_approved" | "awaiting_user_approval" = "awaiting_user_approval";
  let autoApprovedUntil: Date | null = null;
  let remainingPeriodBudgetCents: number | undefined;
  // Surface the policy reason to the agent only when the feature
  // flag is on. With the flag off, every order goes through email
  // confirmation by design — telling the agent "no policy" or
  // "card not on file" would be misleading noise.
  let fallbackReason: string | undefined =
    isAgentBillingEnabled() && !evaluation.approved
      ? evaluation.reason
      : undefined;

  let order: { id: string };
  try {
    [order] = await db
      .insert(printOrders)
      .values({
        userId: input.userId,
        fileAssetId: input.fileAssetId,
        craftCloudCartId: cartId,
        totalPrice,
        serviceFee,
        materialSubtotal: materialPriceCents,
        shippingSubtotal: input.shippingPriceCents,
        quantity: input.quantity,
        material: input.materialConfigId,
        vendor: input.vendorId,
        vendorName: input.vendorName ?? null,
        status: "awaiting_agent_approval",
        shippingAddress: {
          email: input.shippingAddress.email,
          shipping: {
            firstName: input.shippingAddress.firstName,
            lastName: input.shippingAddress.lastName,
            address: input.shippingAddress.address,
            addressLine2: input.shippingAddress.addressLine2,
            city: input.shippingAddress.city,
            zipCode: input.shippingAddress.zipCode,
            stateCode: input.shippingAddress.stateCode,
            countryCode: input.shippingAddress.countryCode,
            phoneNumber: input.shippingAddress.phoneNumber,
          },
          billing: {
            firstName: input.shippingAddress.firstName,
            lastName: input.shippingAddress.lastName,
            address: input.shippingAddress.address,
            addressLine2: input.shippingAddress.addressLine2,
            city: input.shippingAddress.city,
            zipCode: input.shippingAddress.zipCode,
            stateCode: input.shippingAddress.stateCode,
            countryCode: input.shippingAddress.countryCode,
            phoneNumber: input.shippingAddress.phoneNumber,
            isCompany: false,
          },
        },
        initiatedByTokenId: input.initiatedByTokenId,
        agentName: input.agentName,
        confirmationToken,
        confirmationExpiresAt,
        agentIdempotencyKey: input.idempotencyKey,
      })
      .returning({ id: printOrders.id });
  } catch (error) {
    logError("createAgentInitiatedOrder.insertOrder", error);
    return { error: "Failed to create draft order" };
  }

  if (
    isAgentBillingEnabled() &&
    evaluation.approved &&
    billingRow?.stripeCustomerId &&
    billingRow.defaultPaymentMethod
  ) {
    // Off-session charge. Stripe will throw a StripeCardError on
    // most failure modes (declined, requires_action, etc.), which
    // we catch and downgrade to the email-confirm fallback. The
    // user gets an explicit reason in the MCP response and (later)
    // an email with the confirmation link.
    try {
      const stripe = getStripe();
      const intent = await stripe.paymentIntents.create(
        {
          amount: grandTotalCents,
          currency: "usd",
          customer: billingRow.stripeCustomerId,
          payment_method: billingRow.defaultPaymentMethod,
          off_session: true,
          confirm: true,
          metadata: {
            printOrderId: order.id,
            source: "agent",
            token_id: input.initiatedByTokenId,
            type: "print_order_auto_approved",
          },
        },
        // Dedupe the charge against the agent's idempotency key: a retry
        // (the textbook agent-timeout case) returns the same PaymentIntent
        // instead of charging the customer twice. Pairs with a unique DB
        // constraint on (userId, agentIdempotencyKey) — proposed as a
        // follow-up migration, see PR notes.
        { idempotencyKey: `agent-charge:${input.idempotencyKey}` }
      );

      if (intent.status === "succeeded") {
        path = "auto_approved";
        autoApprovedUntil = new Date(
          Date.now() + evaluation.cancellationWindowMinutes * 60 * 1000
        );
        remainingPeriodBudgetCents = evaluation.remainingPeriodBudgetCents;

        // Promote the order to auto_approved in a single atomic
        // update; record the PaymentIntent id in stripeSessionId
        // (reused — the column predates PaymentIntent support and
        // the value is opaque to consumers). Also write the
        // spending ledger row so subsequent orders see this charge
        // counted in the period budget.
        await Promise.all([
          db
            .update(printOrders)
            .set({
              status: "auto_approved",
              autoApprovedUntil,
              stripeSessionId: intent.id,
            })
            .where(eq(printOrders.id, order.id)),
          db.insert(tokenSpendingLedger).values({
            tokenId: input.initiatedByTokenId,
            printOrderId: order.id,
            amountCents: grandTotalCents,
          }),
        ]);
      } else if (intent.status === "requires_action") {
        // 3DS challenge — the issuer wants a human. Fall through
        // to email-confirm; user will pay via Checkout (which
        // handles the challenge inline).
        fallbackReason = "Card requires authentication (3-D Secure)";
      } else {
        fallbackReason = `Charge did not succeed (status: ${intent.status})`;
      }
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        fallbackReason = `Card declined: ${error.message}`;
      } else {
        // Non-card errors are infrastructure failures. Log and
        // fall through; the user can still pay via the email link.
        logError("createAgentInitiatedOrder.charge", error);
        fallbackReason = "Could not auto-charge — payment provider error";
      }
    }
  }

  return {
    orderId: order.id,
    path,
    confirmationToken,
    confirmationExpiresAt: confirmationExpiresAt.toISOString(),
    cancellationDeadline: autoApprovedUntil?.toISOString(),
    totalPriceCents: totalPrice,
    serviceFeeCents: serviceFee,
    remainingPeriodBudgetCents,
    fallbackReason,
  };
}

export interface AgentOrderSummary {
  orderId: string;
  status: string;
  terminal: boolean;
  initiatedByAgent: boolean;
  agentName: string | null;
  totalPriceCents: number;
  serviceFeeCents: number;
  currency: "USD";
  vendor: { id: string | null; name: string | null };
  material: {
    configId: string | null;
    materialName: string | null;
    finishName: string | null;
    color: string | null;
  };
  fileAssetId: string | null;
  fileName: string | null;
  craftCloudOrderId: string | null;
  trackingInfo: {
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

// Exported (test-only need, MTR-155) so the print-order-status
// exhaustiveness test can assert every printOrderStatusEnum value is
// accounted for here without duplicating the set. No logic change.
export const TERMINAL_STATUSES = new Set([
  "received",
  "refunded",
  "cancelled",
]);

/**
 * Resolve a file asset's display name: prefer the linked file's name,
 * fall back to the original upload filename with its extension stripped.
 * Shared by the single- and batch-lookup paths so both shape identical
 * names.
 */
function pickFileName(
  row: { name: string | null; original: string | null } | undefined
): string | null {
  return row?.name ?? row?.original?.replace(/\.[^.]+$/, "") ?? null;
}

/**
 * Batch-resolve display names for many file assets in one query. Keyed
 * by fileAssetId; ids with no row simply don't appear in the map.
 * Lets `listOrdersForUser` avoid a per-order file lookup (CON-79).
 */
async function resolveFileNames(
  assetIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (assetIds.length === 0) return map;
  const rows = await db
    .select({
      id: fileAssets.id,
      name: files.name,
      original: fileAssets.originalFilename,
    })
    .from(fileAssets)
    .leftJoin(files, eq(fileAssets.fileId, files.id))
    .where(inArray(fileAssets.id, assetIds));
  for (const r of rows) {
    map.set(r.id, pickFileName(r));
  }
  return map;
}

async function shapeOrderRow(
  row: typeof printOrders.$inferSelect,
  fileNames?: Map<string, string | null>
): Promise<AgentOrderSummary> {
  const [materialEntry, providerEntry] = await Promise.all([
    row.material ? findMaterialConfig(row.material).catch(() => null) : null,
    row.vendor && !row.vendorName
      ? findProvider(row.vendor).catch(() => null)
      : null,
  ]);

  let fileName: string | null = null;
  if (row.fileAssetId) {
    // Batch path: caller pre-resolved every asset id in one query.
    // Single path: fall back to a per-row lookup.
    if (fileNames) {
      fileName = fileNames.get(row.fileAssetId) ?? null;
    } else {
      const [f] = await db
        .select({
          name: files.name,
          original: fileAssets.originalFilename,
        })
        .from(fileAssets)
        .leftJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(fileAssets.id, row.fileAssetId))
        .limit(1);
      fileName = pickFileName(f);
    }
  }

  return {
    orderId: row.id,
    status: row.status,
    terminal: TERMINAL_STATUSES.has(row.status),
    initiatedByAgent: row.initiatedByTokenId != null,
    agentName: row.agentName,
    totalPriceCents: row.totalPrice,
    serviceFeeCents: row.serviceFee,
    currency: "USD",
    vendor: {
      id: row.vendor,
      name: row.vendorName ?? providerEntry?.name ?? null,
    },
    material: {
      configId: row.material,
      materialName: materialEntry?.material.name ?? null,
      finishName: materialEntry?.finishGroup.name ?? null,
      color: materialEntry?.config.color ?? null,
    },
    fileAssetId: row.fileAssetId,
    fileName,
    craftCloudOrderId: row.craftCloudOrderId,
    trackingInfo: row.trackingInfo ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrderForUser(params: {
  userId: string;
  orderId: string;
}): Promise<AgentOrderSummary | { error: string }> {
  const [row] = await db
    .select()
    .from(printOrders)
    .where(
      and(
        eq(printOrders.id, params.orderId),
        eq(printOrders.userId, params.userId)
      )
    )
    .limit(1);
  if (!row) return { error: "Order not found" };
  return shapeOrderRow(row);
}

export async function listOrdersForUser(params: {
  userId: string;
  limit?: number;
}): Promise<AgentOrderSummary[]> {
  const rows = await db
    .select()
    .from(printOrders)
    .where(eq(printOrders.userId, params.userId))
    .orderBy(desc(printOrders.createdAt))
    .limit(Math.max(1, Math.min(100, params.limit ?? 25)));

  // One file query for the whole page instead of one per order (CON-79).
  const assetIds = [
    ...new Set(
      rows
        .map((r) => r.fileAssetId)
        .filter((id): id is string => id != null)
    ),
  ];
  const fileNames = await resolveFileNames(assetIds);
  return Promise.all(rows.map((row) => shapeOrderRow(row, fileNames)));
}

void printOrderItems;
