import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";
import { FileThumbnailStack } from "@/components/projects/file-thumbnail-stack";
import { PrivateCardMark } from "@/components/ui/visibility-mark";
import {
  FILE_CARD_BODY_CLASS,
  FILE_CARD_SHELL_CLASS,
  FILE_CARD_TITLE_CLASS,
  FILE_CARD_WELL_CLASS,
} from "@/components/files/file-card";

export interface LibraryProjectCardItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  visibility: string;
  source: "owned" | "purchased";
  thumbnailUrl: string | null;
  /** Picked cover photo id, or null when on the "Auto" (first photo) cover. */
  coverPhotoId: string | null;
  fileCount: number;
  /**
   * Curator photo ids beyond the cover. The card carousel renders the
   * cover (via thumbnailUrl / proxy) first, then resolves these via
   * /api/thumbnails/projects/{id}?photoId={id}. Empty when the project
   * has no curator photos other than the cover.
   */
  additionalPhotoIds: string[];
  /**
   * Bundled-file thumbnails (up to 3) for the "stack of 3" fallback
   * cover when the project has no curator photos at all.
   */
  fileThumbnails: string[];
}

interface LibraryProjectCardProps {
  item: LibraryProjectCardItem;
}

export function LibraryProjectCard({ item }: LibraryProjectCardProps) {
  // Carousel slides. When an explicit cover is picked it leads (via
  // the proxy, `?v=` pinned to the pick so a re-pick busts the stale
  // optimizer copy), followed by the remaining curator photos. With
  // no explicit pick the photos lead directly — the proxy's "Auto"
  // fallback already resolves the first photo, so prepending a bare
  // cover URL would just duplicate it (and 404 a broken slide when
  // there are no photos at all). See thumbnails/projects route.
  const photoSlides = item.additionalPhotoIds.map(
    (id) => `/api/thumbnails/projects/${item.id}?photoId=${id}`
  );
  const carouselImages = item.coverPhotoId
    ? [
        `/api/thumbnails/projects/${item.id}?v=${item.coverPhotoId}`,
        ...photoSlides,
      ]
    : photoSlides;
  const isPrivate = item.visibility === "private" && item.source === "owned";
  return (
    <Link href={`/projects/${item.slug}`} className="block">
      <Card className={FILE_CARD_SHELL_CLASS}>
        <div className={FILE_CARD_WELL_CLASS}>
          {carouselImages.length > 0 ? (
            <CardImageCarousel images={carouselImages} alt="" size="sm" />
          ) : item.fileThumbnails.length > 0 ? (
            <FileThumbnailStack thumbnails={item.fileThumbnails} />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-xs text-muted-foreground/50">Project</span>
            </div>
          )}

          {(isPrivate || item.price > 0) && (
            // z-10 keeps the mark above FileThumbnailStack's inline
            // zIndex layers — without it the frosted chip paints under
            // the deck (CON-20).
            <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex flex-wrap items-center gap-1">
              {isPrivate && <PrivateCardMark />}
              {item.price > 0 && (
                <span className="inline-flex items-center rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md ring-1 ring-white/10">
                  ${(item.price / 100).toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>
        <CardContent className={FILE_CARD_BODY_CLASS}>
          <p className={FILE_CARD_TITLE_CLASS}>
            {item.name}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              {item.fileCount} {item.fileCount === 1 ? "file" : "files"}
            </span>
            {item.source === "purchased" && (
              <Badge variant="secondary" className="text-[10px]">
                Purchased
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
