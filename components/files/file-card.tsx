import type { ReactNode, Ref } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { CardImageCarousel } from "@/components/photos/card-image-carousel";
import { FileTitleTooltip } from "@/components/browse/file-title-tooltip";
import { Download } from "@/components/icons/download";
import { formatCompactCount } from "@/lib/utils/format-count";
import { getAvatarGradient } from "@/lib/utils/avatar-gradient";
import { cn } from "@/lib/utils";

/**
 * Shared file-card chrome. Visual source of truth is the /files
 * discover grid — a borderless square media tile on the soft gray
 * surface with title + meta set under it (Shop / App Store style).
 * There is no outer box: the tile itself is the object, and a ring
 * around a ring around the image read as two cards nested.
 *
 * Every file surface (discover, library, project
 * pickers, home recents, typeahead, collection items) renders
 * through this component so the tiles cannot drift.
 *
 * Project / collection *browse* cards that are not files still
 * import the shell/well class constants below so their chrome
 * stays locked to the same numbers.
 */
// Overrides Card's ring, fill, radius and vertical padding: the shell is
// only a layout column. `p-0`/`gap-0` keep the tile flush with the grid.
export const FILE_CARD_SHELL_CLASS =
  "group gap-0 p-0 overflow-visible rounded-none bg-transparent ring-0";

// Inset hairline (ring-inset) rather than a border so white-background
// captures still have an edge on the white canvas without adding a box.
export const FILE_CARD_WELL_CLASS =
  "relative aspect-square overflow-hidden rounded-xl bg-muted ring-1 ring-inset ring-border/60 transition-[box-shadow] duration-150";

export const FILE_CARD_BODY_CLASS = "px-0.5 pt-2.5 pb-1";

export const FILE_CARD_BODY_COMPACT_CLASS = "px-0.5 pt-1.5 pb-1";

export const FILE_CARD_TITLE_CLASS =
  "truncate text-sm leading-5 font-medium";

export const FILE_CARD_TITLE_COMPACT_CLASS =
  "truncate text-xs font-medium";

/** Focus ring for the link/button wrapping a tile; the shell has no box of its own. */
export const FILE_CARD_LINK_CLASS =
  "block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const FILE_CARD_SELECTED_WELL_CLASS = "ring-2 ring-foreground ring-inset";

const MEDIA_HOVER_CLASS =
  "transition-transform duration-200 ease-out group-hover:scale-[1.03]";

export function fileCardPhotoUrls(
  fileId: string,
  thumbnailUrl: string | null | undefined,
  additionalPhotoIds: string[] = []
): string[] {
  if (!thumbnailUrl) return [];
  return [
    thumbnailUrl,
    ...additionalPhotoIds.map((id) => `/api/thumbnails/${fileId}?photoId=${id}`),
  ];
}

export function formatFileDimensions(
  dims: [number, number, number] | null | undefined
): string | null {
  if (!dims) return null;
  return `${dims[0].toFixed(1)} × ${dims[1].toFixed(1)} × ${dims[2].toFixed(1)} mm`;
}

/** Extension line — e.g. `.stl`. Kept for placeholders / non-card surfaces. */
export function formatFileExtension(
  format: string | null | undefined
): string | null {
  if (!format) return null;
  const trimmed = format.trim().replace(/^\./, "");
  if (!trimmed) return null;
  return `.${trimmed.toLowerCase()}`;
}

/**
 * Human-readable file size for owned-card subtitles — e.g. `340 KB`, `1.2 MB`.
 * Returns null for missing/non-positive sizes so the subtitle row collapses.
 */
export function formatFileSize(
  bytes: number | null | undefined
): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Subtitle for a file the viewer owns (library, Recent, project bundle).
 * Size beats extension on compact tiles — almost everything is STL/3MF,
 * while byte size is useful when scanning your own library. Bounding box
 * stays off the card (CON-19); it belongs in the quote flow.
 */
export function fileCardOwnedSubtitle(
  fileSizeBytes: number | null | undefined
): string | null {
  return formatFileSize(fileSizeBytes);
}

/** Subtitle for a purchased file — who you bought it from. */
export function fileCardPurchasedSubtitle(
  creatorDisplayName?: string | null,
  creatorUsername?: string | null
): string | null {
  const name = creatorDisplayName?.trim() || creatorUsername?.trim();
  return name ? `by ${name}` : null;
}

export function FileCardPriceBadge({ priceCents }: { priceCents: number }) {
  if (priceCents <= 0) return null;
  return (
    <span className="absolute top-2 left-2 rounded-full bg-background px-2 py-0.5 text-xs leading-5 font-medium tabular-nums shadow-sm">
      ${(priceCents / 100).toFixed(2)}
    </span>
  );
}

export function FileCardCreator({
  username,
  displayName,
  avatarUrl,
}: {
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}) {
  const seed = username || displayName || "";
  const label = displayName || username || "Unknown";
  const remoteAvatar =
    !!avatarUrl &&
    (avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://"));
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-muted-foreground">
      {remoteAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          className="flex h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ background: getAvatarGradient(seed) }}
        />
      )}
      <span className="truncate">{label}</span>
    </p>
  );
}

export function FileCardDownloads({ count }: { count: number }) {
  return (
    <div className="mt-1 flex items-center">
      <span
        className="inline-flex items-center gap-1 text-xs text-subtle-foreground tabular-nums"
        aria-label={`${count} downloads`}
        title={`${count} downloads`}
      >
        <Download size={12} />
        {formatCompactCount(count)}
      </span>
    </div>
  );
}

export interface FileCardProps {
  title: string;
  /** When set, the card is a link. Combine with `onClick` to close a panel. */
  href?: string;
  /** When set without `href`, the card is a toggle button (pickers). */
  onClick?: () => void;
  onNavigate?: () => void;
  selected?: boolean;
  /** Narrow carousel tiles (typeahead, home recents). */
  compact?: boolean;
  className?: string;
  images?: string[];
  thumbnailUrl?: string | null;
  placeholder?: ReactNode;
  /** Replaces default media (library capture spinner, custom empty). */
  well?: ReactNode;
  wellRef?: Ref<HTMLDivElement>;
  overlay?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
}

export function FileCard({
  title,
  href,
  onClick,
  onNavigate,
  selected = false,
  compact = false,
  className,
  images,
  thumbnailUrl,
  placeholder,
  well,
  wellRef,
  overlay,
  subtitle,
  meta,
}: FileCardProps) {
  const resolvedImages =
    images && images.length > 0
      ? images
      : thumbnailUrl
        ? [thumbnailUrl]
        : [];

  const media =
    well !== undefined ? (
      well
    ) : resolvedImages.length > 0 ? (
      <CardImageCarousel
        images={resolvedImages}
        alt=""
        size="sm"
        className={MEDIA_HOVER_CLASS}
      />
    ) : placeholder ? (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground/50">
        {placeholder}
      </div>
    ) : null;

  const subtitleNode =
    subtitle == null || subtitle === "" ? null : typeof subtitle ===
        "string" || typeof subtitle === "number" ? (
      <p
        className={cn(
          "mt-0.5 truncate text-muted-foreground",
          compact ? "text-[10px]" : "text-xs"
        )}
      >
        {subtitle}
      </p>
    ) : (
      subtitle
    );

  const card = (
    <Card
      data-slot="file-card"
      data-selected={selected ? "true" : undefined}
      className={FILE_CARD_SHELL_CLASS}
    >
      <div
        ref={wellRef}
        className={cn(FILE_CARD_WELL_CLASS, selected && FILE_CARD_SELECTED_WELL_CLASS)}
      >
        {media}
        {overlay}
        {selected && (
          <span className="pointer-events-none absolute top-2 right-2 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
            ✓
          </span>
        )}
      </div>
      <CardContent
        className={compact ? FILE_CARD_BODY_COMPACT_CLASS : FILE_CARD_BODY_CLASS}
      >
        <FileTitleTooltip
          title={title}
          className={
            compact ? FILE_CARD_TITLE_COMPACT_CLASS : FILE_CARD_TITLE_CLASS
          }
        />
        {subtitleNode}
        {meta}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={onNavigate ?? onClick}
        className={cn(FILE_CARD_LINK_CLASS, compact && "w-28 shrink-0", className)}
      >
        {card}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(FILE_CARD_LINK_CLASS, "w-full text-left", compact && "w-28 shrink-0", className)}
      >
        {card}
      </button>
    );
  }

  return <div className={cn(compact && "w-28 shrink-0", className)}>{card}</div>;
}
