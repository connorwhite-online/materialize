import { cn } from "@/lib/utils";

interface Props {
  /**
   * Full thumbnail URLs (files.thumbnailUrl) in display order. Only
   * the first three are used. Render nothing when empty so callers
   * can fall through to their own placeholder.
   */
  thumbnails: string[];
  className?: string;
}

/**
 * "Cute stack of 3" fallback cover for a project that has no curator
 * photos and no picked cover — fan the bundled files' thumbnails out
 * as a little layered deck so the project still reads as visual
 * content instead of an empty gradient. Used by the project detail
 * cover and the library project card.
 *
 * Plain <img> (not next/image) on purpose: draft/private file
 * thumbnails are session-gated, and the optimizer fetches without
 * Clerk cookies (CON-23). Same reason `CardImageCarousel` sets
 * `unoptimized` for `/api/thumbnails/**` srcs.
 */
export function FileThumbnailStack({ thumbnails, className }: Props) {
  const top = thumbnails.filter(Boolean).slice(0, 3);
  if (top.length === 0) return null;

  // Back-to-front so the first thumbnail sits on top. Each deeper
  // card is nudged + rotated a touch and scaled down for depth.
  // Tile width is w-3/4 of the well (bumped from w-3/5 in CON-20).
  const layers = top
    .map((src, i) => ({ src, i }))
    .reverse();

  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center",
        className
      )}
    >
      {layers.map(({ src, i }) => {
        // Slightly tighter stagger than before so the larger tiles
        // still fit inside the square well without clipping hard.
        const offset = i * 6; // px
        const rotate = i === 0 ? 0 : i === 1 ? -5 : 5;
        const scale = 1 - i * 0.05;
        return (
          <div
            key={i}
            className="absolute aspect-square w-3/4 overflow-hidden rounded-xl border border-border bg-muted shadow-sm"
            style={{
              transform: `translate(${i % 2 === 0 ? offset : -offset}px, ${offset}px) rotate(${rotate}deg) scale(${scale})`,
              zIndex: top.length - i,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-full w-full object-cover" />
          </div>
        );
      })}
    </div>
  );
}
