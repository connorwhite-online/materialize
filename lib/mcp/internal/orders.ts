import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";
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
import { createCart, CraftCloudApiError } from "@/lib/craftcloud/client";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { computePeriodStart, evaluateSpendingPolicy } from "@/lib/billing/policy";
import { getStripe } from "@/lib/stripe";
import { logError } from "@/lib/logger";
import type { Currency } from "@/lib/craftcloud/types";

const SERVICE_FEE_RATE = 0.03;
const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete a budget reservation (the ledger row written before charging)
 * when the charge doesn't go through, so a failed charge never counts
 * against the token's period budget. Best-effort: a failure here
 * over-counts the budget (conservative — blocks future orders rather
 * than allowing overspend), so we only log it.
 */
async function releaseReservation(printOrderId: string): Promise<void> {
  try {
    await db
      .delete(tokenSpendingLedger)
      .where(eq(tokenSpendingLedger.printOrderId, printOrderId));
  } catch (error) {
    logError("createAgentInitiatedOrder.releaseReservation", error);
  }
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
    input.materialPriceCents * input.quantity + productionFeeCents;
  const totalPrice = preShippingTotal + input.shippingPriceCents;
  const serviceFee = Math.round(preShippingTotal * SERVICE_FEE_RATE);
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
        materialSubtotal: input.materialPriceCents,
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
    billingRow.defaultPaymentMethod &&
    policyRow?.spendingPolicy
  ) {
    const policy = policyRow.spendingPolicy;

    // Atomically RESERVE the period budget under a per-token advisory
    // lock so two concurrent orders can't both pass the budget check
    // and overspend (CON-77). The ledger row IS the reservation: it is
    // inserted inside the locked transaction, making the budget re-check
    // + ledger write atomic (CON-81). The charge happens OUTSIDE the
    // lock; if it fails we release the reservation, so a failed charge
    // never counts against budget. Lock is held only for the quick
    // re-check + insert — never across the Stripe network call.
    let reserved = false;
    try {
      reserved = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`agent-budget:${input.initiatedByTokenId}`}))`
        );
        const periodStart = computePeriodStart(policy.periodWindow, new Date());
        const rows = await tx
          .select({ amountCents: tokenSpendingLedger.amountCents })
          .from(tokenSpendingLedger)
          .where(
            and(
              eq(tokenSpendingLedger.tokenId, input.initiatedByTokenId),
              gte(tokenSpendingLedger.chargedAt, periodStart)
            )
          );
        const spent = rows.reduce((sum, r) => sum + r.amountCents, 0);
        if (spent + grandTotalCents > policy.periodBudgetCents) return false;
        await tx.insert(tokenSpendingLedger).values({
          tokenId: input.initiatedByTokenId,
          printOrderId: order.id,
          amountCents: grandTotalCents,
        });
        remainingPeriodBudgetCents =
          policy.periodBudgetCents - spent - grandTotalCents;
        return true;
      });
    } catch (error) {
      logError("createAgentInitiatedOrder.reserveBudget", error);
      reserved = false;
    }

    if (!reserved) {
      // A concurrent order consumed the remaining budget (or the
      // reservation failed) — fall through to confirm-by-email.
      fallbackReason = `Exceeds ${policy.periodWindow} budget`;
    } else {
      // Off-session charge. Stripe throws StripeCardError on most
      // failure modes (declined, requires_action, etc.); on any
      // non-success we RELEASE the reservation and downgrade to the
      // email-confirm fallback.
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
          // returns the same PaymentIntent instead of charging twice.
          { idempotencyKey: `agent-charge:${input.idempotencyKey}` }
        );

        if (intent.status === "succeeded") {
          path = "auto_approved";
          autoApprovedUntil = new Date(
            Date.now() + evaluation.cancellationWindowMinutes * 60 * 1000
          );
          // Ledger row already written by the reservation; just promote
          // the order. Record the PaymentIntent id in stripeSessionId
          // (reused column, opaque to consumers).
          await db
            .update(printOrders)
            .set({
              status: "auto_approved",
              autoApprovedUntil,
              stripeSessionId: intent.id,
            })
            .where(eq(printOrders.id, order.id));
        } else if (intent.status === "requires_action") {
          // 3DS challenge — release the reservation; user pays via the
          // emailed Checkout link (which handles the challenge inline).
          await releaseReservation(order.id);
          remainingPeriodBudgetCents = undefined;
          fallbackReason = "Card requires authentication (3-D Secure)";
        } else {
          await releaseReservation(order.id);
          remainingPeriodBudgetCents = undefined;
          fallbackReason = `Charge did not succeed (status: ${intent.status})`;
        }
      } catch (error) {
        await releaseReservation(order.id);
        remainingPeriodBudgetCents = undefined;
        if (error instanceof Stripe.errors.StripeCardError) {
          fallbackReason = `Card declined: ${error.message}`;
        } else {
          // Non-card errors are infrastructure failures. Log and fall
          // through; the user can still pay via the email link.
          logError("createAgentInitiatedOrder.charge", error);
          fallbackReason = "Could not auto-charge — payment provider error";
        }
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

const TERMINAL_STATUSES = new Set([
  "received",
  "refunded",
  "cancelled",
]);

async function shapeOrderRow(
  row: typeof printOrders.$inferSelect
): Promise<AgentOrderSummary> {
  const [materialEntry, providerEntry] = await Promise.all([
    row.material ? findMaterialConfig(row.material).catch(() => null) : null,
    row.vendor && !row.vendorName
      ? findProvider(row.vendor).catch(() => null)
      : null,
  ]);

  let fileName: string | null = null;
  if (row.fileAssetId) {
    const [f] = await db
      .select({
        name: files.name,
        original: fileAssets.originalFilename,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, row.fileAssetId))
      .limit(1);
    fileName =
      f?.name ?? f?.original?.replace(/\.[^.]+$/, "") ?? null;
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
  return Promise.all(rows.map(shapeOrderRow));
}

void printOrderItems;
