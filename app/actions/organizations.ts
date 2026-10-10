"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationMembers, organizations } from "@/lib/db/schema";
import { buildUniqueHandle, validateHandle } from "@/lib/handles/validate";
import { logError } from "@/lib/logger";
import { slugifyOrganizationName } from "@/lib/orgs/slug";

/**
 * A slug for a new organization that is free in our `/[handle]`
 * namespace (users, orgs, reserved words). Passed to Clerk's
 * `createOrganization` so Clerk doesn't invent one: left to itself it
 * appends a long numeric suffix ("acme-1791666319545359126").
 */
export async function suggestOrganizationSlug(
  name: string
): Promise<{ slug: string } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to create an organization." };
  const stem = slugifyOrganizationName(name);
  if (!stem) return { error: "Use at least one letter or number in the name." };
  try {
    return { slug: await buildUniqueHandle(stem) };
  } catch (error) {
    logError("suggestOrganizationSlug", error);
    return { error: "Couldn't check that name. Try again." };
  }
}

/**
 * Mirror a just-created organization (and the creator's membership)
 * into our tables, so the redirect to its page doesn't 404 while the
 * Clerk webhook is still in flight. Insert-only: the webhook stays the
 * writer of record (app/api/webhooks/clerk/route.ts) and overwrites
 * these rows when it lands. Returns the local slug to redirect to.
 */
export async function finishOrganizationCreate(
  organizationId: string
): Promise<{ slug: string } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to create an organization." };

  try {
    const clerk = await clerkClient();
    const { data: memberships } =
      await clerk.organizations.getOrganizationMembershipList({
        organizationId,
        limit: 100,
      });
    const mine = memberships.find(
      (m) => m.publicUserData?.userId === userId
    );
    // Only a member may mirror an org; anything else is someone
    // poking at the action with a foreign id.
    if (!mine) return { error: "Organization not found." };

    const org = mine.organization;
    const conflict = await validateHandle(org.slug ?? "", {
      ignoreOrgId: org.id,
    });
    const localSlug = conflict
      ? await buildUniqueHandle(org.slug ?? org.name, { ignoreOrgId: org.id })
      : (org.slug as string);

    await db
      .insert(organizations)
      .values({
        id: org.id,
        name: org.name,
        slug: localSlug,
        imageUrl: org.hasImage ? org.imageUrl : null,
        updatedAt: new Date(org.updatedAt),
      })
      .onConflictDoNothing({ target: organizations.id });
    await db
      .insert(organizationMembers)
      .values({
        id: mine.id,
        organizationId: org.id,
        userId,
        role: mine.role.startsWith("org:") ? mine.role.slice(4) : mine.role,
      })
      .onConflictDoNothing({ target: organizationMembers.id });

    // The webhook may already have written the row, possibly under a
    // different local slug; redirect to whatever is stored.
    const [row] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .limit(1);
    return { slug: row?.slug ?? localSlug };
  } catch (error) {
    logError("finishOrganizationCreate", error);
    return { error: "Your organization was created, but its page isn't ready yet." };
  }
}
