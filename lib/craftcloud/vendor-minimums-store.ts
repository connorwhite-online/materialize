import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { craftCloudVendorMinimums } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

/**
 * The shared tier behind vendor-minimums.ts's per-instance Map. Every
 * cold serverless instance used to re-learn every vendor's minimum by
 * creating its own throwaway CraftCloud carts; this lets one instance's
 * probe serve all of them for the TTL.
 *
 * Best-effort both ways: a failed read means "probe as before", and a
 * failed write only costs another probe later.
 */

export async function readSharedMinimums(
  currency: string,
  vendorIds: string[],
  freshSince: Date
): Promise<Map<string, { minimum: number; fetchedAt: number }>> {
  const out = new Map<string, { minimum: number; fetchedAt: number }>();
  if (vendorIds.length === 0) return out;
  try {
    const rows = await db
      .select({
        vendorId: craftCloudVendorMinimums.vendorId,
        minimum: craftCloudVendorMinimums.minimum,
        fetchedAt: craftCloudVendorMinimums.fetchedAt,
      })
      .from(craftCloudVendorMinimums)
      .where(
        and(
          eq(craftCloudVendorMinimums.currency, currency),
          inArray(craftCloudVendorMinimums.vendorId, vendorIds),
          gte(craftCloudVendorMinimums.fetchedAt, freshSince)
        )
      );
    for (const row of rows) {
      out.set(row.vendorId, {
        minimum: row.minimum,
        fetchedAt: row.fetchedAt.getTime(),
      });
    }
  } catch (error) {
    logError("vendorMinimums.sharedRead", error);
  }
  return out;
}

export async function writeSharedMinimums(
  currency: string,
  entries: { vendorId: string; minimum: number; fetchedAt: number }[]
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db
      .insert(craftCloudVendorMinimums)
      .values(
        entries.map((e) => ({
          currency,
          vendorId: e.vendorId,
          minimum: e.minimum,
          fetchedAt: new Date(e.fetchedAt),
        }))
      )
      .onConflictDoUpdate({
        target: [
          craftCloudVendorMinimums.currency,
          craftCloudVendorMinimums.vendorId,
        ],
        set: {
          minimum: sql`excluded.minimum`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  } catch (error) {
    logError("vendorMinimums.sharedWrite", error);
  }
}
