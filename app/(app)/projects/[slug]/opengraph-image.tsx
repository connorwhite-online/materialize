import { db } from "@/lib/db";
import { projects, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";

export const alt = "Materialize project";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [row] = await db
    .select({
      name: projects.name,
      thumbnailUrl: projects.thumbnailUrl,
      status: projects.status,
      visibility: projects.visibility,
      displayName: users.displayName,
      username: users.username,
    })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug));

  if (!row || row.status !== "published" || row.visibility !== "public") {
    return renderOgCard({ title: "Materialize", subtitle: null });
  }

  const creator = row.displayName || row.username;
  return renderOgCard({
    title: row.name,
    subtitle: creator ? `Project by ${creator}` : "Project",
    imageUrl: row.thumbnailUrl,
  });
}
