import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";

export const alt = "Materialize creator profile";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [user] = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.username, username));

  if (!user) {
    return renderOgCard({ title: "Materialize", subtitle: null });
  }

  const name = user.displayName || user.username || username;
  const handle = user.username ? `@${user.username}` : null;
  const subtitle = user.bio?.trim()
    ? user.bio
    : handle
    ? `${handle} on Materialize`
    : "Creator on Materialize";

  return renderOgCard({
    title: name,
    subtitle,
    imageUrl: user.avatarUrl,
    imageShape: "circle",
  });
}
