import { db } from "@/lib/db";
import { files, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";

export const alt = "Materialize file";
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
      name: files.name,
      thumbnailUrl: files.thumbnailUrl,
      status: files.status,
      displayName: users.displayName,
      username: users.username,
    })
    .from(files)
    .innerJoin(users, eq(files.userId, users.id))
    .where(eq(files.slug, slug));

  // Unpublished/missing — render a brand-only card so the meta tag
  // never points at a 404 image. Crawlers won't be here anyway since
  // generateMetadata sets noindex for these.
  if (!row || row.status !== "published") {
    return renderOgCard({ title: "Materialize", subtitle: null });
  }

  const creator = row.displayName || row.username;
  // Full-bleed, contained. The thumbnail is a transparent-background
  // WebP capture of the model normalized to fill a square viewport
  // (`components/viewer/thumbnail-capture.tsx`), so `cover` would crop
  // the part's top and bottom away. Contained at full height on the
  // brand background it still reads as full-bleed — the capture's
  // transparent background and the card's background are the same
  // colour, so there is no visible letterbox.
  return renderOgCard({
    title: row.name,
    subtitle: creator ? `by ${creator}` : null,
    layout: "full",
    fit: "contain",
    imageUrl: row.thumbnailUrl,
  });
}
