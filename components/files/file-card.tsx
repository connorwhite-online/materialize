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
 * discover grid — inset square well, title + meta under the thumb,
 * hover border. Every file surface (discover, library, project
 * pickers, home recents, typeahead, collection items) renders
 * through this component so the tiles cannot drift.
 *
 * Project / collection *browse* cards that are not files still
 * import the shell/well class constants below so their chrome
 * stays locked to the same numbers.
 */
export const FILE_CARD_SHELL_CLASS =
  "group gap-0 p-1 overflow-hidden transition-colors hover:border-primary/30";

export const FILE_CARD_WELL_CLASS =
  "relative aspect-square overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted to-muted/50";

export const FILE_CARD_BODY_CLASS = "p-2.5";

export const FILE_CARD_BODY_COMPACT_CLASS = "px-2 py-2";

export const FILE_CARD_TITLE_CLASS =
  "truncate text-sm font-medium group-hover:text-primary transition-colors";

export const FILE_CARD_TITLE_COMPACT_CLASS =
  "truncate text-xs font-medium group-hover:text-primary transition-colors";

const FILE_CARD_SELECTED_CLASS = "border-primary ring-2 ring-primary/40";

const MEDIA_HOVER_CLASS =
  "transition-transform duration-300 group-hover:scale-105";

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

/** Extension line for own-library / Recent / print tiles — e.g. `.stl`. */
export function formatFileExtension(
  format: string | null | undefined
): string | null {
  if (!format) return null;
  const trimmed = format.trim().replace(/^\./, "");
  if (!trimmed) return null;
  return `.${trimmed.toLowerCase()}`;
}

/**
 * Subtitle for a file the viewer owns (library, Recent, project bundle).
 * Format beats bounding box on compact tiles — the full W×D×H truncates
 * and belongs in the quote flow, not as the permanent scan line.
 */
export function fileCardOwnedSubtitle(
  format: string | null | undefined
): string | null {
  return formatFileExtension(format);
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
    <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-1 text-xs font-medium tabular-nums backdrop-blur-sm">
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
    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
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
    <div className="mt-1.5 flex items-center">
      <span
        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums"
        aria-label={`${count} downloads`}
        title={`${count} downloads`}
      >
        <Download size={11} />
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
      className={cn(FILE_CARD_SHELL_CLASS, selected && FILE_CARD_SELECTED_CLASS)}
    >
      <div ref={wellRef} className={FILE_CARD_WELL_CLASS}>
        {media}
        {overlay}
        {selected && (
          <span className="pointer-events-none absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
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
        className={cn("block", compact && "w-28 shrink-0", className)}
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
        className={cn("block w-full text-left", compact && "w-28 shrink-0", className)}
      >
        {card}
      </button>
    );
  }

  return <div className={cn(compact && "w-28 shrink-0", className)}>{card}</div>;
}
