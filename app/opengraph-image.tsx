import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
 * The art is the landing hero's "Host the whole build" step — the
 * Pneuma S enclosure exploded, captured from the real 3D scene
 * (`public/og/landing-exploded.png`, see `public/og/README.md`) — with the
 * "M" bottom-left. Dark only, like every other OG card: link previews
 * have no theme to follow, and the scene itself is shot on `#0a0a0a`-ish
 * black.
 *
 * Static: no params, no fetches, so Next renders it once at build time.
 */

export const alt =
  "Materialize — a marketplace for 3D-print files with on-demand 3D printing";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  // Read off disk as a data URL: a build-time render has no request, so
  // the relative-URL resolution the per-entity cards use isn't available.
  const art = await readFile(join(process.cwd(), "public/og/landing-exploded.png"));
  return renderOgCard({
    title: "Materialize",
    subtitle: "3D-print files marketplace · on-demand printing",
    imageUrl: `data:image/png;base64,${art.toString("base64")}`,
    layout: "full",
    fit: "cover",
    mark: true,
  });
}
