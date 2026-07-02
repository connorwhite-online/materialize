import "server-only";

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fileAssets,
  files,
  personalAccessTokens,
  printOrders,
  tokenSpendingLedger,
} from "@/lib/db/schema";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { sendEmail } from "@/lib/email/client";
import {
  AgentOrderConfirmationEmail,
  renderAgentOrderConfirmationText,
} from "@/lib/email/templates/agent-order-confirmation";
import {
  AgentOrderAutoApprovedEmail,
  renderAgentOrderAutoApprovedText,
} from "@/lib/email/templates/agent-order-auto-approved";
import {
  AgentOrderCancellationConfirmedEmail,
  renderAgentOrderCancellationConfirmedText,
} from "@/lib/email/templates/agent-order-cancellation-confirmed";
import { computePeriodStart, type SpendingPolicy } from "@/lib/billing/policy";
import { logError } from "@/lib/logger";

/**
 * Send the agent-initiated-order confirmation email.
 *
 * The caller passes only `orderId` — we resolve the file name,
 * material/finish/color, and vendor name from the order row and the
 * cached CraftCloud catalog. This keeps callers simple and avoids
 * "I forgot to plumb that field through" bugs (the early stub
 * version had nulls leaking into the user-facing email).
 *
 * Returns `{ ok: true }` even when Resend isn't configured — the
 * client wrapper falls back to a console-log stub so local dev
 * doesn't require a real Resend account.
 *
 * `appUrl` should be the caller's request-derived base URL (e.g.
 * `await deriveAppUrl()` from `lib/utils/request-url.ts`) so the
 * confirm/cancel links in this email don't bake in a dead
 * `NEXT_PUBLIC_APP_URL` localhost fallback. Optional because this
 * module can theoretically be invoked from a background/cron
 * context with no live request to derive a host from — in that case
 * only, we fall back to the env var / localhost below.
 */
export async function sendOrderConfirmationEmail(params: {
  orderId: string;
  appUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const [row] = await db
      .select()
      .from(printOrders)
      .where(eq(printOrders.id, params.orderId))
      .limit(1);

    if (!row) return { ok: false, error: "Order not found" };
    if (!row.shippingAddress?.email) {
      return { ok: false, error: "Order has no shipping email" };
    }
    if (!row.confirmationToken) {
      return { ok: false, error: "Order has no confirmation token" };
    }

    const [materialEntry, providerEntry, fileRow] = await Promise.all([
      row.material ? findMaterialConfig(row.material).catch(() => null) : null,
      row.vendor && !row.vendorName
        ? findProvider(row.vendor).catch(() => null)
        : null,
      row.fileAssetId
        ? db
            .select({
              name: files.name,
              originalFilename: fileAssets.originalFilename,
            })
            .from(fileAssets)
            .leftJoin(files, eq(fileAssets.fileId, files.id))
            .where(eq(fileAssets.id, row.fileAssetId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : null,
    ]);

    const fileName =
      fileRow?.name ??
      fileRow?.originalFilename?.replace(/\.[^.]+$/, "") ??
      "Untitled model";

    const materialName = [
      materialEntry?.material.name,
      materialEntry?.config.color,
      materialEntry?.finishGroup.name
        ? `(${materialEntry.finishGroup.name})`
        : null,
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || "Material details unavailable";

    const vendorName =
      row.vendorName ?? providerEntry?.name ?? "Vendor details unavailable";

    const totalDisplay = formatPrice(row.totalPrice + row.serviceFee);
    // Prefer the request-derived URL passed by the caller (see the
    // `appUrl` param doc above); only fall back to the build-time env
    // var / localhost when no caller-derived URL is available.
    const appUrl =
      params.appUrl ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";
    const revokeAgentUrl = `${appUrl}/dashboard/settings/tokens`;
    const agentName = row.agentName ?? "An agent";

    if (row.status === "auto_approved" && row.autoApprovedUntil) {
      const cancelUrl = `${appUrl}/orders/${row.id}/cancel?token=${row.confirmationToken}`;
      const cancelDeadlineDisplay = formatRelativeFuture(row.autoApprovedUntil);
      const remainingBudgetDisplay =
        await formatRemainingBudget(row.initiatedByTokenId);

      return await sendEmail({
        to: row.shippingAddress.email,
        subject: `${agentName} placed an order — cancel ${cancelDeadlineDisplay}`,
        react: AgentOrderAutoApprovedEmail({
          agentName,
          fileName,
          materialName,
          vendorName,
          totalDisplay,
          cancelUrl,
          cancelDeadlineDisplay,
          remainingBudgetDisplay,
          revokeAgentUrl,
        }),
        text: renderAgentOrderAutoApprovedText({
          agentName,
          fileName,
          materialName,
          vendorName,
          totalDisplay,
          cancelUrl,
          cancelDeadlineDisplay,
          remainingBudgetDisplay,
          revokeAgentUrl,
        }),
      });
    }

    // Default: confirm-by-email flow (today's path).
    if (!row.confirmationExpiresAt) {
      return { ok: false, error: "Order is not awaiting confirmation" };
    }
    const confirmationUrl = `${appUrl}/orders/${row.id}/confirm?token=${row.confirmationToken}`;
    const expiresAtDisplay = formatExpiry(row.confirmationExpiresAt);

    return await sendEmail({
      to: row.shippingAddress.email,
      subject: `Confirm print order from ${agentName} — Materialize`,
      react: AgentOrderConfirmationEmail({
        agentName,
        fileName,
        materialName,
        vendorName,
        totalDisplay,
        confirmationUrl,
        revokeAgentUrl,
        expiresAtDisplay,
      }),
      text: renderAgentOrderConfirmationText({
        agentName,
        fileName,
        materialName,
        vendorName,
        totalDisplay,
        confirmationUrl,
        revokeAgentUrl,
        expiresAtDisplay,
      }),
    });
  } catch (error) {
    logError("sendOrderConfirmationEmail", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Sent after the user clicks "Cancel" on an auto-approved order
 * during the cancellation window. Resolves order details from the
 * order id and dispatches the cancellation-confirmed template.
 *
 * `appUrl` is optional for the same reason as in
 * `sendOrderConfirmationEmail` above: pass the caller's
 * request-derived base URL when one is available. The current sole
 * caller (`cancelAutoApprovedOrder` in `app/actions/agent-orders.ts`)
 * is out of scope for MTR-131's file list, so it still doesn't pass
 * one — this falls back to the env var / localhost below until that
 * caller is updated in a follow-up.
 */
export async function sendCancellationConfirmedEmail(params: {
  orderId: string;
  appUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const [row] = await db
      .select()
      .from(printOrders)
      .where(eq(printOrders.id, params.orderId))
      .limit(1);

    if (!row) return { ok: false, error: "Order not found" };
    if (!row.shippingAddress?.email) {
      return { ok: false, error: "Order has no shipping email" };
    }

    const fileRow = row.fileAssetId
      ? await db
          .select({
            name: files.name,
            originalFilename: fileAssets.originalFilename,
          })
          .from(fileAssets)
          .leftJoin(files, eq(fileAssets.fileId, files.id))
          .where(eq(fileAssets.id, row.fileAssetId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    const fileName =
      fileRow?.name ??
      fileRow?.originalFilename?.replace(/\.[^.]+$/, "") ??
      "Untitled model";

    const totalDisplay = formatPrice(row.totalPrice + row.serviceFee);
    const appUrl =
      params.appUrl ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";

    const props = {
      agentName: row.agentName ?? "An agent",
      fileName,
      totalDisplay,
      ordersUrl: `${appUrl}/dashboard/orders`,
      revokeAgentUrl: `${appUrl}/dashboard/settings/tokens`,
    };

    return await sendEmail({
      to: row.shippingAddress.email,
      subject: `Order cancelled — refund of ${totalDisplay} on the way`,
      react: AgentOrderCancellationConfirmedEmail(props),
      text: renderAgentOrderCancellationConfirmedText(props),
    });
  } catch (error) {
    logError("sendCancellationConfirmedEmail", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Looks up the token's spending policy + the period spend so far,
 * formats "$X.XX of $Y.YY remaining" for display in the auto-approved
 * email. Returns null if the token has no policy (so we just don't
 * show that line) or the lookup fails — never blocks the email.
 */
async function formatRemainingBudget(
  tokenId: string | null
): Promise<string | null> {
  if (!tokenId) return null;
  try {
    const [tokenRow] = await db
      .select({ spendingPolicy: personalAccessTokens.spendingPolicy })
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, tokenId))
      .limit(1);
    const policy = tokenRow?.spendingPolicy as SpendingPolicy | null | undefined;
    if (!policy) return null;

    const periodStart = computePeriodStart(policy.periodWindow, new Date());
    const recent = await db
      .select({ amountCents: tokenSpendingLedger.amountCents })
      .from(tokenSpendingLedger)
      .where(
        and(
          eq(tokenSpendingLedger.tokenId, tokenId),
          gte(tokenSpendingLedger.chargedAt, periodStart)
        )
      );
    const spent = recent.reduce((sum, r) => sum + r.amountCents, 0);
    const remaining = Math.max(0, policy.periodBudgetCents - spent);
    return `${formatPrice(remaining)} of ${formatPrice(policy.periodBudgetCents)} this ${policy.periodWindow}`;
  } catch (err) {
    logError("formatRemainingBudget", err);
    return null;
  }
}

/**
 * "in 5 minutes" / "in less than a minute" — used for the cancel
 * deadline in the auto-approved email subject + body.
 */
function formatRelativeFuture(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "shortly";
  const minutes = Math.round(diffMs / (60 * 1000));
  if (minutes < 1) return "in less than a minute";
  if (minutes === 1) return "in 1 minute";
  return `in ${minutes} minutes`;
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatExpiry(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours <= 1) return "in less than an hour";
  if (hours < 36) return `in ${hours} hours`;
  return `on ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}
