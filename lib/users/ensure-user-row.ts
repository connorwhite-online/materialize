import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logError } from "@/lib/logger";

/**
 * Make sure a `users` row exists for a Clerk user, creating it from
 * Clerk's record when it doesn't.
 *
 * The Clerk webhook (`app/api/webhooks/clerk/route.ts`) is the normal
 * writer, but it can lag or miss: a user whose row never landed can sign
 * in fine and then fail every write with an FK violation. This is for
 * paths that start from a bare Clerk user id with no page in between,
 * like an MCP client's first OAuth request.
 *
 * The row is stamped with Clerk's own `updatedAt`, the same logical
 * clock the webhook compares against (CON-80), so any later webhook
 * event still applies over it. Returns false when the row could not be
 * created; callers decide whether that is fatal.
 */
export async function ensureUserRow(userId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing) return true;

  let values: typeof users.$inferInsert;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const displayName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" ");
    values = {
      id: userId,
      username: user.username ?? null,
      displayName: displayName || null,
      avatarUrl: user.hasImage ? user.imageUrl : null,
      updatedAt: new Date(user.updatedAt),
    };
  } catch (err) {
    logError("ensureUserRow.clerk", err);
    return false;
  }

  try {
    await db.insert(users).values(values).onConflictDoNothing();
  } catch {
    // Most likely the unique username belongs to someone else's stale
    // row. The account matters more than the handle here; the webhook
    // or onboarding sets the username later.
    try {
      await db
        .insert(users)
        .values({ ...values, username: null })
        .onConflictDoNothing();
    } catch (err) {
      logError("ensureUserRow.insert", err);
      return false;
    }
  }
  return true;
}
