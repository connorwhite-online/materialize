import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og/render-card";

/**
 * Site-wide Open Graph card.
 *
 * Per-entity cards already exist for files, projects, materials and
 * profiles, but nothing covered the home page or any other route — so
 * every share of materialize.cc itself rendered as a bare text link.
 * For a domain with no backlink profile that matters more than usual:
 * shares are how the first links get earned, and a link preview with a
 * blank card converts worse than one that shows what the site is.
 *
 * Living in the root segment means this is the fallback for every route
 * that doesn't ship its own opengraph-image — the leaf cards in
 * `(app)/files/[slug]`, `(app)/projects/[slug]`, `(app)/materials/[slug]`
 * and `(app)/[handle]` still take precedence on their own routes.
 *
 * Static: no params, no fetches, so Next renders it once at build time.
 */

export const alt =
  "Materialize — a marketplace for 3D-print files with on-demand 3D printing";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    title: "Materialize",
    subtitle: "3D-print files marketplace · on-demand printing",
  });
}
