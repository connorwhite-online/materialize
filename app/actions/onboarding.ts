"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
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
