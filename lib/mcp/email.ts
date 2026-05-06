import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printOrders, fileAssets, files } from "@/lib/db/schema";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { sendEmail } from "@/lib/email/client";
import {
  AgentOrderConfirmationEmail,
  renderAgentOrderConfirmationText,
} from "@/lib/email/templates/agent-order-confirmation";
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
 */
export async function sendOrderConfirmationEmail(params: {
  orderId: string;
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
    if (!row.confirmationToken || !row.confirmationExpiresAt) {
      return { ok: false, error: "Order is not awaiting confirmation" };
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const confirmationUrl = `${appUrl}/orders/${row.id}/confirm?token=${row.confirmationToken}`;
    const revokeAgentUrl = `${appUrl}/dashboard/settings/tokens`;
    const expiresAtDisplay = formatExpiry(row.confirmationExpiresAt);

    const templateProps = {
      agentName: row.agentName ?? "An agent",
      fileName,
      materialName,
      vendorName,
      totalDisplay,
      confirmationUrl,
      revokeAgentUrl,
      expiresAtDisplay,
    };

    return await sendEmail({
      to: row.shippingAddress.email,
      subject: `Confirm print order from ${templateProps.agentName} — Materialize`,
      react: AgentOrderConfirmationEmail(templateProps),
      text: renderAgentOrderConfirmationText(templateProps),
    });
  } catch (error) {
    logError("sendOrderConfirmationEmail", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
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
