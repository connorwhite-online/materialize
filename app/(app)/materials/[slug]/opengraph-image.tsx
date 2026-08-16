import { findMaterialBySlug } from "@/lib/craftcloud/catalog";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";

export const alt = "Materialize 3D printing material";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Resolve catalog image paths the same way the page does — Cloudinary
// optimizer for relative paths, pass-through for absolute URLs.
function resolveCatalogImage(path: string, width: number): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_${width},q_auto,f_auto/${path}`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hit = await findMaterialBySlug(slug);

  if (!hit) {
    return renderOgCard({ title: "Materialize", subtitle: null });
  }

  const { material, group } = hit;
  // Full-bleed: the catalog product shot fills the whole 1200×630.
  // Chat clients and social cards already print the material name and
  // the domain directly under the image, so the in-card title was
  // duplicating that while squeezing the photo into a third of the
  // frame. With no photo, renderOgCard falls back to the split card
  // and the title carries the link on its own.
  return renderOgCard({
    title: material.name,
    subtitle: `${group.name} · 3D printing material`,
    layout: "full",
    fit: "cover",
    imageUrl: material.featuredImage
      ? resolveCatalogImage(material.featuredImage, OG_SIZE.width)
      : null,
  });
}
