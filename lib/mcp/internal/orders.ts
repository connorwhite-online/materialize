import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  fileAssets,
  files,
  printOrders,
  printOrderItems,
} from "@/lib/db/schema";
import { createCart, CraftCloudApiError } from "@/lib/craftcloud/client";
import { findMaterialConfig, findProvider } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";
import type { Currency } from "@/lib/craftcloud/types";

const SERVICE_FEE_RATE = 0.03;
const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

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
  confirmationToken: string;
  confirmationExpiresAt: string;
  totalPriceCents: number;
  serviceFeeCents: number;
}

export async function createAgentInitiatedOrder(
  input: CreateAgentOrderInput
): Promise<CreateAgentOrderResult | { error: string }> {
  const [existing] = await db
    .select({
      id: printOrders.id,
      confirmationToken: printOrders.confirmationToken,
      confirmationExpiresAt: printOrders.confirmationExpiresAt,
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
    if (existing.status !== "awaiting_agent_approval") {
      return { error: "Idempotency key was used for an order that is no longer awaiting approval" };
    }
    return {
      orderId: existing.id,
      confirmationToken: existing.confirmationToken ?? "",
      confirmationExpiresAt:
        existing.confirmationExpiresAt?.toISOString() ?? "",
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

  const confirmationToken = nanoid(32);
  const confirmationExpiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS);

  try {
    const [order] = await db
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

    return {
      orderId: order.id,
      confirmationToken,
      confirmationExpiresAt: confirmationExpiresAt.toISOString(),
      totalPriceCents: totalPrice,
      serviceFeeCents: serviceFee,
    };
  } catch (error) {
    logError("createAgentInitiatedOrder.insertOrder", error);
    return { error: "Failed to create draft order" };
  }
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
