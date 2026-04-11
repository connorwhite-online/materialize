"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { profileSchema, socialLinksSchema } from "@/lib/validations/file";

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

  await db
    .update(users)
    .set({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      bio: parsed.data.bio,
    })
    .where(eq(users.id, userId));

  revalidatePath("/dashboard/settings");
}

export async function updateSocialLinks(linksJson: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const parsed = socialLinksSchema.safeParse(JSON.parse(linksJson));
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  await db
    .update(users)
    .set({ socialLinks: parsed.data })
    .where(eq(users.id, userId));

  revalidatePath("/dashboard/settings");
}
