import type { Metadata } from "next";
import {
  getCraftCloudCatalog,
  type MaterialGroup,
} from "@/lib/craftcloud/catalog";
import { CatalogBrowser } from "@/components/materials/catalog-browser";
import type { BrowseMaterialGroup } from "@/components/materials/catalog-material-card";
import { logError } from "@/lib/logger";
import { safeJsonLdScript } from "@/lib/seo/json-ld";

// The root layout applies a `%s · Materialize` title template, so this
// must NOT restate the brand — it previously read "Materials |
// Materialize" and rendered as "Materials | Materialize · Materialize".
export const metadata: Metadata = {
  title: "3D Printing Materials & Finishes",
  description:
    "Browse 60+ 3D printing materials — PLA, PETG, ABS, nylon, resin, stainless steel, aluminium and titanium — with finishes, colors and live per-material pricing from vetted manufacturers.",
  alternates: { canonical: "/materials" },
};

// ISR rather than a one-shot static build. The catalog comes from
// CraftCloud's edge, which intermittently 403-challenges datacenter
// IPs — a cold prerender during `next build` can be challenged and,
// without this, would fail the whole deploy. Revalidating on a daily
// cadence means a build that fell back to the empty state (below)
// self-heals on the next revalidation instead of being frozen empty
// until the next deploy. Mirrors sitemap.ts's daily revalidate.
export const revalidate = 86_400;

export default async function MaterialsPage() {
  // The catalog fetch can throw (CraftCloud outage / edge challenge).
  // Degrade to an empty browse view rather than 500 the page or fail
  // the build — same resilience contract sitemap.ts uses. The strict,
  // throwing catalog is still what the quote hot-path depends on; we
  // only soften it here, at the marketing surface.
  let groups: MaterialGroup[] = [];
  try {
    const catalog = await getCraftCloudCatalog();
    groups = catalog.groups;
  } catch (e) {
    logError("materials:catalog", e);
  }

  const totalMaterials = groups.reduce((sum, g) => sum + g.materials.length, 0);
  const unavailable = groups.length === 0;

  // Narrow to just what CatalogBrowser/CatalogMaterialCard read before
  // crossing into the "use client" boundary (PERF-17). The full
  // CraftCloud MaterialGroup/CatalogMaterial carries ~25 fields per
  // material — nested finishGroups/materialConfigs, mechanical/thermal
  // property ranges, tags — that the browse grid never touches; only
  // this DTO needs to serialize over the RSC wire.
  const browseGroups: BrowseMaterialGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    materials: g.materials.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      featuredImage: m.featuredImage,
      descriptionShort: m.descriptionShort,
      sortIndex: m.sortIndex,
    })),
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Materialize materials catalog",
    numberOfItems: totalMaterials,
    itemListElement: groups.flatMap((g) =>
      g.materials.map((m, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/materials/${m.slug}`,
        name: m.name,
      }))
    ),
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdScript(jsonLd) }}
      />
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Materials</h1>
        <p className="mt-1 text-muted-foreground">
          {unavailable
            ? "Our material catalog is temporarily unavailable. Please check back in a moment."
            : `Browse ${totalMaterials} 3D printing materials across ${groups.length} families. Each with unique properties for your project.`}
        </p>
      </div>

      {!unavailable && <CatalogBrowser groups={browseGroups} />}
    </div>
  );
}
