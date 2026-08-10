"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nanoid } from "nanoid";
import { logError } from "@/lib/logger";
import { validateHandle } from "@/lib/handles/validate";
import { clerkErrorMessage } from "@/lib/clerk/error-message";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
} from "@/lib/handles/limits";

const usernameSchema = z
  .string()
  .min(MIN_USERNAME_LENGTH, `At least ${MIN_USERNAME_LENGTH} characters`)
  .max(MAX_USERNAME_LENGTH, `Max ${MAX_USERNAME_LENGTH} characters`)
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

    // Unified handle check — guards against (a) reserved top-level
    // route words, (b) other users' usernames, AND (c) existing org
    // slugs, since the new `/[handle]` namespace shares those three.
    // `ignoreUserId` lets the viewer keep their own current username.
    const conflict = await validateHandle(normalized, {
      ignoreUserId: userId,
    });
    if (conflict) return { error: conflict };

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
    // Clerk validation failures (422) carry a user-facing reason —
    // surface it rather than a dead-end "Failed to set username" the
    // user can't act on. Non-Clerk errors fall back to the generic
    // copy so internals never leak.
    return { error: clerkErrorMessage(error) ?? "Failed to set username" };
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
      // First attempt uses the raw prefix (if long enough to clear
      // MIN_USERNAME_LENGTH). Subsequent attempts append a short
      // nanoid so "jo" becomes "jo-a4f2". Keeping this in step with
      // the constant matters: a too-short candidate isn't rejected
      // locally, it burns a retry on a guaranteed Clerk 422.
      const needsSuffix = attempt > 0 || base.length < MIN_USERNAME_LENGTH;
      const candidate = needsSuffix
        ? `${base}-${nanoid(4).toLowerCase()}`
        : base;

      // Unified collision check — the candidate also can't clash
      // with a reserved word or an existing org slug. Otherwise an
      // unlucky email like jane@vercel.com would derive `vercel`
      // and steal the org slug.
      const conflict = await validateHandle(candidate, {
        ignoreUserId: userId,
      });
      if (conflict) continue;

      try {
        await clerk.users.updateUser(userId, { username: candidate });
      } catch (clerkErr) {
        // Clerk distinguishes 422 (username already taken) from
        // other failure modes (rate limit, auth, outage). Only
        // retry on 422 — everything else gets surfaced so we
        // don't burn retries on a real outage and leave the user
        // stranded mid-signup.
        const status =
          clerkErr &&
          typeof clerkErr === "object" &&
          "status" in clerkErr
            ? (clerkErr as { status?: number }).status
            : undefined;
        if (status && status !== 422) {
          logError("setUsernameFromEmail.clerkNonCollision", clerkErr);
          return {
            error: "Account provider is temporarily unavailable.",
          };
        }
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
