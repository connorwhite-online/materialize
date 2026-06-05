"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { profileSchema, socialLinksSchema } from "@/lib/validations/file";
import { validateHandle } from "@/lib/handles/validate";
import { logError } from "@/lib/logger";

export async function updateProfile(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = profileSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    bio: formData.get("bio"),
  });

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    // Normalize + validate the handle the same way onboarding does:
    // lowercase, then guard against reserved route words, other users'
    // usernames, and existing org slugs (the `/[handle]` namespace).
    // Keep Clerk in sync so a later Clerk webhook can't revert it. (CON-76)
    const username = parsed.data.username.toLowerCase();
    const conflict = await validateHandle(username, { ignoreUserId: userId });
    if (conflict) return { error: { username: [conflict] } };

    const clerk = await clerkClient();
    await clerk.users.updateUser(userId, { username });

    await db
      .update(users)
      .set({
        username,
        displayName: parsed.data.displayName,
        bio: parsed.data.bio,
      })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
  } catch (error) {
    logError("updateProfile", error);
    return { error: { username: ["Failed to save. Please try again."] } };
  }
}

const ACCEPTED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Upload (or replace) the signed-in user's avatar.
 *
 * Clerk is the source of truth for avatars — the clerk webhook maps
 * `image_url` → `users.avatarUrl` — so we push the image through Clerk's
 * backend API rather than R2. We then mirror the returned `imageUrl`
 * into our own row right away so the new avatar shows without waiting on
 * the webhook (which never fires in local dev).
 */
export async function updateAvatar(
  formData: FormData
): Promise<{ avatarUrl: string | null } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No image selected" };
  }
  if (!ACCEPTED_AVATAR_TYPES.has(file.type.toLowerCase())) {
    return { error: "Unsupported image format. Use JPG, PNG, WEBP or GIF." };
  }
  if (file.size > MAX_AVATAR_SIZE) {
    return { error: "Image exceeds the 10MB limit." };
  }

  try {
    const clerk = await clerkClient();
    const updated = await clerk.users.updateUserProfileImage(userId, { file });
    const avatarUrl = updated.imageUrl ?? null;

    await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
    return { avatarUrl };
  } catch (error) {
    logError("updateAvatar", error);
    return { error: "Failed to upload image. Please try again." };
  }
}

/**
 * Remove the signed-in user's avatar, reverting to the gradient
 * fallback. Mirrors `updateAvatar`: clears the image in Clerk, then
 * nulls our cached `avatarUrl`.
 */
export async function removeAvatar(): Promise<
  { ok: true } | { error: string }
> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  try {
    const clerk = await clerkClient();
    await clerk.users.deleteUserProfileImage(userId);

    await db.update(users).set({ avatarUrl: null }).where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    logError("removeAvatar", error);
    return { error: "Failed to remove image. Please try again." };
  }
}

export async function updateDefaultUploadVisibility(
  visibility: "public" | "private"
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  if (visibility !== "public" && visibility !== "private") {
    return { error: "Invalid value" };
  }

  try {
    await db
      .update(users)
      .set({ defaultUploadVisibility: visibility })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    logError("updateDefaultUploadVisibility", error);
    return { error: "Failed to save. Please try again." };
  }
}

/**
 * Master switch for transactional notification emails (comments, replies,
 * makes). The in-app bell stays on regardless; this only governs whether
 * we also fire an email per event.
 */
export async function updateEmailNotificationsEnabled(
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  try {
    await db
      .update(users)
      .set({ emailNotificationsEnabled: !!enabled })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    logError("updateEmailNotificationsEnabled", error);
    return { error: "Failed to save. Please try again." };
  }
}

const ALLOWED_PREF_TYPES = new Set([
  "comment_on_listing",
  "reply_to_comment",
  "build_on_file",
  "print_on_file",
]);

/**
 * Toggle a single notification type's email pref. Reads the current
 * jsonb map, sets the requested key, and writes back. Anything outside
 * the known type set is rejected so the caller can't poison the column
 * with arbitrary keys.
 */
export async function updateEmailNotificationPref(
  type: string,
  enabled: boolean
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };
  if (!ALLOWED_PREF_TYPES.has(type)) return { error: "Unknown event type" };

  try {
    const [current] = await db
      .select({ prefs: users.emailNotificationPrefs })
      .from(users)
      .where(eq(users.id, userId));
    const next = {
      ...(current?.prefs ?? {}),
      [type]: enabled,
    };

    await db
      .update(users)
      .set({ emailNotificationPrefs: next })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (error) {
    logError("updateEmailNotificationPref", error);
    return { error: "Failed to save. Please try again." };
  }
}

export async function updateSocialLinks(linksJson: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  let linksData: unknown;
  try {
    linksData = JSON.parse(linksJson);
  } catch {
    return { error: { formErrors: ["Invalid data format"] } };
  }

  const parsed = socialLinksSchema.safeParse(linksData);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  try {
    await db
      .update(users)
      .set({ socialLinks: parsed.data })
      .where(eq(users.id, userId));

    revalidatePath("/dashboard/settings");
  } catch (error) {
    logError("updateSocialLinks", error);
  }
}
