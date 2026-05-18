import { db } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";
import { resolveHandle } from "@/lib/handles/resolve";

// Shared OG image for the unified `/[handle]` namespace. Resolves
// the handle to either a user or an org and renders the appropriate
// card. Falls back to a generic Materialize card on miss so a stale
// link never produces a broken image.

export const alt = "Materialize profile";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const resolution = await resolveHandle(handle);
  if (!resolution) {
    return renderOgCard({ title: "Materialize", subtitle: null });
  }

  if (resolution.kind === "user") {
    const [user] = await db
      .select({
        username: users.username,
        displayName: users.displayName,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, resolution.userId));
    if (!user) return renderOgCard({ title: "Materialize", subtitle: null });
    const name = user.displayName || user.username || handle;
    const at = user.username ? `@${user.username}` : null;
    const subtitle = user.bio?.trim()
      ? user.bio
      : at
      ? `${at} on Materialize`
      : "Creator on Materialize";
    return renderOgCard({
      title: name,
      subtitle,
      imageUrl: user.avatarUrl,
      imageShape: "circle",
    });
  }

  const [org] = await db
    .select({
      name: organizations.name,
      slug: organizations.slug,
      bio: organizations.bio,
      imageUrl: organizations.imageUrl,
    })
    .from(organizations)
    .where(eq(organizations.id, resolution.orgId));
  if (!org) return renderOgCard({ title: "Materialize", subtitle: null });
  const subtitle = org.bio?.trim()
    ? org.bio
    : `@${org.slug} on Materialize`;
  return renderOgCard({
    title: org.name,
    subtitle,
    imageUrl: org.imageUrl,
    imageShape: "circle",
  });
}
