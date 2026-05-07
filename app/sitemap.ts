import type { MetadataRoute } from "next";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";

/**
 * Sitemap for crawlers and agent discovery.
 *
 * The marketplace browser surfaces (/, /materials, /files) plus
 * one entry per material slug from the live CraftCloud catalog.
 * Per-file user listings aren't included — there are too many,
 * they churn often, and a public marketplace listing index is
 * already linked from /files.
 *
 * Revalidates daily — material catalog changes infrequently and the
 * upstream catalog already caches for 24h.
 */

export const revalidate = 86_400;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${APP_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${APP_URL}/materials`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${APP_URL}/files`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${APP_URL}/print`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${APP_URL}/llms.txt`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${APP_URL}/llms-full.txt`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
  ];

  let materialEntries: MetadataRoute.Sitemap = [];
  try {
    const catalog = await getCraftCloudCatalog();
    const seenSlugs = new Set<string>();
    for (const group of catalog.groups) {
      for (const m of group.materials) {
        if (!m.slug || seenSlugs.has(m.slug)) continue;
        seenSlugs.add(m.slug);
        materialEntries.push({
          url: `${APP_URL}/materials/${m.slug}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.7,
        });
      }
    }
  } catch {
    // Catalog fetch can fail (CraftCloud outage, etc.) — return the
    // static surface alone so the sitemap is always valid even when
    // the upstream is down.
    materialEntries = [];
  }

  return [...staticEntries, ...materialEntries];
}
