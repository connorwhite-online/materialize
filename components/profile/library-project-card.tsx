import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";

export interface LibraryProjectCardItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  visibility: string;
  source: "owned" | "purchased";
  thumbnailUrl: string | null;
  fileCount: number;
  /**
   * Curator photo ids beyond the cover. The card carousel renders the
   * cover (via thumbnailUrl / proxy) first, then resolves these via
   * /api/thumbnails/projects/{id}?photoId={id}. Empty when the project
   * has no curator photos other than the cover.
   */
  additionalPhotoIds: string[];
}

interface LibraryProjectCardProps {
  item: LibraryProjectCardItem;
}

export function LibraryProjectCard({ item }: LibraryProjectCardProps) {
  // The cover always resolves through the thumbnails proxy so an
  // edited cover-photo pick takes effect immediately. Items with
  // neither a cover nor any additional photos render a placeholder.
  const carouselImages = [
    `/api/thumbnails/projects/${item.id}`,
    ...item.additionalPhotoIds.map(
      (id) => `/api/thumbnails/projects/${item.id}?photoId=${id}`
    ),
  ];
  const hasAnyImage = !!item.thumbnailUrl || item.additionalPhotoIds.length > 0;
  return (
    <Link href={`/projects/${item.slug}`} className="block">
      <Card className="overflow-hidden transition-colors hover:border-primary/30">
        <div className="relative aspect-square bg-gradient-to-br from-muted to-muted/50">
          {hasAnyImage ? (
            <CardImageCarousel images={carouselImages} alt="" size="sm" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-xs text-muted-foreground/50">Project</span>
            </div>
          )}
        </div>
        <CardContent className="p-3 space-y-1">
          <p className="text-sm font-medium line-clamp-1">{item.name}</p>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {item.fileCount} {item.fileCount === 1 ? "file" : "files"}
            </Badge>
            {item.source === "purchased" && (
              <Badge variant="secondary" className="text-[10px]">
                Purchased
              </Badge>
            )}
            {item.visibility === "private" && item.source === "owned" && (
              <Badge variant="outline" className="text-[10px]">
                Private
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {item.price > 0
              ? `$${(item.price / 100).toFixed(2)}`
              : "Free"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
