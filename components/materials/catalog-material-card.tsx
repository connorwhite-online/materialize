import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CatalogMaterial, MaterialGroup } from "@/lib/craftcloud/catalog";

interface CatalogMaterialCardProps {
  material: CatalogMaterial;
  // Group is passed through but no longer rendered on the card —
  // the cards are already organized into group sections above. Kept
  // in the signature in case we want to re-surface it later.
  group: MaterialGroup;
}

/**
 * Marketing-style card for the materials browse page. Renders
 * CraftCloud's `featuredImage` at top, the material name (truncated
 * to one line), a two-line description, and a single row of tag
 * chips that clips on overflow rather than wrapping.
 */
export function CatalogMaterialCard({
  material,
}: CatalogMaterialCardProps) {
  const tags = material.tags ?? [];

  return (
    <Link href={`/materials/${material.slug}`}>
      <Card className="group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/40 to-muted/10">
          {material.featuredImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveCatalogImage(material.featuredImage)}
              alt={material.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          )}
        </div>

        <CardContent className="p-3">
          <h3 className="truncate font-semibold text-sm transition-colors group-hover:text-primary">
            {material.name}
          </h3>
          {material.descriptionShort && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
              {material.descriptionShort}
            </p>
          )}
          {tags.length > 0 && (
            <div
              className="mt-3 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              // Don't hijack touch scroll on the parent Link — browsers
              // treat a drag as a scroll gesture, not a tap, so swiping
              // to browse tags won't trigger navigation.
            >
              {tags.map((t) => (
                <Badge
                  key={t.id}
                  variant="secondary"
                  className="shrink-0 text-[10px] whitespace-nowrap"
                >
                  {t.name}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_600,q_auto,f_auto/${path}`;
}
