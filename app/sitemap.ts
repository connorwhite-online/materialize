import type { MetadataRoute } from "next";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { db } from "@/lib/db";
import { files, projects, users } from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { logError } from "@/lib/logger";
import { projectHasBundledFile } from "@/lib/projects/listed";
import { CATEGORIES } from "@/lib/categories";

/**
 * Sitemap for crawlers and agent discovery.
 *
 * Static surfaces (/, /materials, /files) + CraftCloud material
 * slugs + every public, published file / project / profile in the
 * database. Daily revalidate keeps it fresh without a write-time
 * sitemap-rebuild step; for the sizes we're at, regenerating the
 * full list on a 24h cadence is fine.
 *
 * If we cross the 50,000-URL-per-sitemap limit we'll split into a
 * sitemap index — far away today.
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

  // Curated category facets on the browse page. These are a finite,
  // known set (unlike `?q=` free-text search, which /files marks
  // noindex) and each one is a real landing page for "3d print files
  // for <category>" queries, so they belong in the sitemap. The
  // canonical emitted by /files' generateMetadata matches this URL
  // shape exactly — keep the two in step.
  const categoryEntries: MetadataRoute.Sitemap = CATEGORIES.map((c) => ({
    url: `${APP_URL}/files?category=${c.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

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

  // Marketplace listings. The page-level visibility check on
  // /files/[slug] and /projects/[slug] gates non-owners on
  // `status === 'published'`, plus visibility = 'public' for
  // projects. Mirror that here so the sitemap only ever points at
  // pages that won't 404 for the crawler.
  let fileEntries: MetadataRoute.Sitemap = [];
  let projectEntries: MetadataRoute.Sitemap = [];
  let profileEntries: MetadataRoute.Sitemap = [];

  try {
    const rows = await db
      .select({
        slug: files.slug,
        updatedAt: files.updatedAt,
      })
      .from(files)
      .where(eq(files.status, "published"));
    fileEntries = rows.map((r) => ({
      url: `${APP_URL}/files/${r.slug}`,
      lastModified: r.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.6,
    }));
  } catch (e) {
    logError("sitemap:files", e);
  }

  try {
    const rows = await db
      .select({
        slug: projects.slug,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(
        and(
          eq(projects.status, "published"),
          eq(projects.visibility, "public"),
          projectHasBundledFile()
        )
      );
    projectEntries = rows.map((r) => ({
      url: `${APP_URL}/projects/${r.slug}`,
      lastModified: r.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.6,
    }));
  } catch (e) {
    logError("sitemap:projects", e);
  }

  try {
    const rows = await db
      .select({
        username: users.username,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(isNotNull(users.username));
    profileEntries = rows.map((r) => ({
      url: `${APP_URL}/${r.username}`,
      lastModified: r.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.5,
    }));
  } catch (e) {
    logError("sitemap:users", e);
  }

  return [
    ...staticEntries,
    ...categoryEntries,
    ...materialEntries,
    ...fileEntries,
    ...projectEntries,
    ...profileEntries,
  ];
}
