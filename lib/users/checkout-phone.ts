import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

/**
 * Saves the shipping phone from a checkout onto the buyer's profile, so
 * we have it for phone sign-in later (which must verify it — this value
 * is unverified). Latest checkout wins. Best-effort: a failure here must
 * never block a payment.
 */
export async function rememberCheckoutPhone(
  userId: string,
  phoneNumber: string | undefined
): Promise<void> {
  const phone = phoneNumber?.trim();
  if (!phone) return;
  try {
    await db.update(users).set({ phoneNumber: phone }).where(eq(users.id, userId));
  } catch (error) {
    logError("rememberCheckoutPhone", error);
  }
}
