import Link from "next/link";
import Image from "next/image";

/**
 * Narrow DTO for the materials browse page (PERF-17). CraftCloud's
 * full `CatalogMaterial` (lib/craftcloud/catalog.ts) carries ~25
 * fields — nested finishGroups/materialConfigs, mechanical/thermal
 * property ranges, tags, etc. — that this card and CatalogBrowser
 * never read. Sending the full shape from the server page down to
 * this "use client" component (and its siblings, one per material)
 * multiplies the RSC wire payload for no UI benefit; only these
 * fields cross that boundary. The full type stays in use on
 * /materials/[slug], which needs the whole material.
 */
export interface BrowseMaterial {
  id: string;
  slug: string;
  name: string;
  featuredImage?: string;
  descriptionShort?: string;
  sortIndex?: number;
}

/** Narrow DTO mirror of MaterialGroup — see BrowseMaterial above. */
export interface BrowseMaterialGroup {
  id: string;
  name: string;
  materials: BrowseMaterial[];
}

interface CatalogMaterialCardProps {
  material: BrowseMaterial;
  // Group is passed through but no longer rendered on the card —
  // the cards are already organized into group sections above. Kept
  // in the signature in case we want to re-surface it later.
  group: BrowseMaterialGroup;
}

/**
 * Tile for the materials browse grid: CraftCloud's `featuredImage`, the
 * material name and a two-line description. Same borderless tile as the
 * file cards on /files (media on the soft gray surface, text under it),
 * so the two browse surfaces read as one system. Tags are surfaced on
 * the detail page only; the grid is dense enough without them.
 */
export function CatalogMaterialCard({
  material,
}: CatalogMaterialCardProps) {
  return (
    <Link
      href={`/materials/${material.slug}`}
      className="group block min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border/60 ring-inset">
        {material.featuredImage && (
          <Image
            src={resolveCatalogImage(material.featuredImage)}
            alt=""
            fill
            sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
            className="object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div className="px-0.5 pt-2.5">
        <h3 className="truncate text-sm leading-5 font-medium">
          {material.name}
        </h3>
        {material.descriptionShort && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
            {material.descriptionShort}
          </p>
        )}
      </div>
    </Link>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_600,q_auto,f_auto/${path}`;
}
