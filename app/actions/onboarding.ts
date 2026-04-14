"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nanoid } from "nanoid";
import { logError } from "@/lib/logger";

const usernameSchema = z
  .string()
  .min(3, "At least 3 characters")
  .max(30, "Max 30 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Letters, numbers, underscores, hyphens only");

export async function setUsername(
  username: string
): Promise<{ success: true } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message };
    }

    const normalized = parsed.data.toLowerCase();

    // Check if username already taken
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, normalized));

    if (existing && existing.id !== userId) {
      return { error: "Username already taken" };
    }

    // Update Clerk
    const clerk = await clerkClient();
    await clerk.users.updateUser(userId, { username: normalized });

    // Upsert our DB record (user may not exist yet if webhook hasn't fired)
    await db
      .insert(users)
      .values({
        id: userId,
        username: normalized,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { username: normalized },
      });

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    logError("setUsername", error);
    return { error: "Failed to set username" };
  }
}

/**
 * Auto-provision a username from an email address. Used by the
 * anon-checkout OTP flow where the user never got to pick a handle
 * themselves — we strip the local-part, sanitize it, and retry with
 * a short random suffix on collision. Best-effort: the caller
 * should NOT block a successful checkout on this returning ok.
 */
export async function setUsernameFromEmail(
  email: string
): Promise<{ success: true; username: string } | { error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { error: "Unauthorized" };

    const rawPrefix = email.split("@")[0] ?? "";
    const base =
      rawPrefix
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 20) || "user";

    const clerk = await clerkClient();

    for (let attempt = 0; attempt < 5; attempt++) {
      // First attempt uses the raw prefix (if long enough to pass
      // the min-3 requirement). Subsequent attempts append a short
      // nanoid so "jo" becomes "jo-a4f2".
      const needsSuffix = attempt > 0 || base.length < 3;
      const candidate = needsSuffix
        ? `${base}-${nanoid(4).toLowerCase()}`
        : base;

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, candidate));
      if (existing && existing.id !== userId) continue;

      try {
        await clerk.users.updateUser(userId, { username: candidate });
      } catch {
        // Clerk enforces its own uniqueness and can 422 even when
        // our DB row hasn't been written yet (webhook lag). Treat
        // as a collision and try a new candidate.
        continue;
      }

      await db
        .insert(users)
        .values({ id: userId, username: candidate })
        .onConflictDoUpdate({
          target: users.id,
          set: { username: candidate },
        });

      revalidatePath("/dashboard");
      return { success: true, username: candidate };
    }

    return { error: "Could not allocate a username" };
  } catch (error) {
    logError("setUsernameFromEmail", error);
    return { error: "Failed to set username" };
  }
}
