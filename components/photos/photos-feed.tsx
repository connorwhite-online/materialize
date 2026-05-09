"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "@/components/icons/x";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import { UserAvatar } from "@/components/auth/user-avatar";
import { PhotoUploader } from "./photo-uploader";
import { DeletePhotoButton } from "./delete-photo-button";
import { timeAgo } from "@/lib/utils/time";

export type FeedPhoto = {
  id: string;
  downloadUrl: string;
  caption: string | null;
  createdAt: Date | string;
  /** "creator" = listing-owner curator photo; "make" = community print. */
  kind: "creator" | "make";
  /**
   * Author for community photos. Null for creator photos — the byline
   * is implicit (they're posted by the listing owner who's already
   * surfaced in the action card).
   */
  author: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

interface PhotosFeedProps {
  photos: FeedPhoto[];
  fileId: string;
  /** Listing owner; can delete any photo on the listing. */
  ownerId: string;
  viewerId: string | null;
  /**
   * What action the trailing uploader fires. Omit (or pass null /
   * undefined) to hide the uploader for viewers who can't post —
   * anon visitors and signed-in non-printers.
   */
  uploadAs?: "creator" | "make" | null;
}

/**
 * Unified photos feed for a file detail page. Combines the curator
 * gallery and the community print photos into one chronological
 * carousel of square thumbnails. Click any → lightbox at native
 * aspect ratio. Owners (and the photo's poster) get a corner-X
 * delete button. The trailing carousel slot is the photo uploader,
 * sized to match the thumbnails. Empty-state collapses to a small
 * standalone uploader so an empty listing doesn't show a
 * gallery-shaped void.
 */
export function PhotosFeed({
  photos,
  fileId,
  ownerId,
  viewerId,
  uploadAs,
}: PhotosFeedProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const canUpload = !!uploadAs;

  // Nothing to render — anon viewer with no photos.
  if (photos.length === 0 && !canUpload) return null;

  // Empty but the viewer can post — show the compact uploader so
  // there's a clear add affordance without the gallery-shaped frame.
  if (photos.length === 0 && uploadAs) {
    return (
      <div className="flex items-center gap-3">
        <PhotoUploader fileId={fileId} kind={uploadAs} size="sm" />
        <p className="text-xs text-muted-foreground">
          {uploadAs === "creator"
            ? "Add a photo of this part"
            : "Share a photo of your print"}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
        {photos.map((photo, i) => {
          const canDelete =
            viewerId !== null &&
            (viewerId === photo.author?.id ||
              viewerId === ownerId ||
              (photo.kind === "creator" && viewerId === ownerId));
          return (
            <PhotoThumb
              key={photo.id}
              photo={photo}
              index={i}
              onOpen={setLightboxIndex}
              canDelete={canDelete}
            />
          );
        })}

        {uploadAs && (
          <div className="shrink-0 aspect-square w-32 sm:w-40 snap-start">
            <PhotoUploader fileId={fileId} kind={uploadAs} size="lg" />
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </>
  );
}

interface PhotoThumbProps {
  photo: FeedPhoto;
  index: number;
  onOpen: (index: number) => void;
  canDelete: boolean;
}

function PhotoThumb({ photo, index, onOpen, canDelete }: PhotoThumbProps) {
  // Anchor for direct deep-links coming from the bell ("added a
  // photo" notifications point at #make-<id>). Only set on community
  // photos for backward compatibility with the existing notification
  // payload shape.
  const id = photo.kind === "make" ? `make-${photo.id}` : undefined;

  return (
    <div
      id={id}
      className="group relative shrink-0 aspect-square w-32 sm:w-40 snap-start scroll-mt-24 overflow-hidden rounded-xl border border-border bg-muted/30"
    >
      <button
        type="button"
        onClick={() => onOpen(index)}
        className="absolute inset-0 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={photo.caption || `Photo ${index + 1}`}
      >
        <img
          src={photo.downloadUrl}
          alt={photo.caption || ""}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </button>

      {/* Author byline overlay — community photos only. Creator
          photos render bare since the byline is implicit in the
          listing's action card. pointer-events-none so the click
          falls through to the lightbox-opening button. */}
      {photo.kind === "make" && photo.author && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2 py-1.5">
          <UserAvatar
            seed={photo.author.username || photo.author.id}
            imageUrl={photo.author.avatarUrl}
            displayName={
              photo.author.displayName ||
              photo.author.username ||
              "Anonymous"
            }
            className="h-4 w-4 shrink-0 ring-1 ring-white/40"
          />
          <span className="truncate text-[10px] font-medium text-white">
            {photo.author.displayName ||
              photo.author.username ||
              "Anonymous"}
          </span>
          <span className="ml-auto shrink-0 text-[9px] text-white/70 tabular-nums">
            {timeAgo(photo.createdAt)}
          </span>
        </div>
      )}

      {canDelete && <DeletePhotoButton photoId={photo.id} />}
    </div>
  );
}

interface LightboxProps {
  photos: FeedPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

/**
 * Fullscreen overlay that renders a single photo at its native
 * aspect ratio. Backdrop click, Escape, or the corner X closes it;
 * arrow keys (and on-screen chevrons when there are siblings) page
 * through the album.
 */
function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
}: LightboxProps) {
  const photo = photos[index];

  const goPrev = useCallback(() => {
    onIndexChange(index === 0 ? photos.length - 1 : index - 1);
  }, [index, photos.length, onIndexChange]);

  const goNext = useCallback(() => {
    onIndexChange(index === photos.length - 1 ? 0 : index + 1);
  }, [index, photos.length, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, onClose]);

  // Lock body scroll while the lightbox is open so the page behind
  // doesn't shift when the user uses arrow keys / scrollwheel.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={18} />
      </button>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="Previous photo"
            className="absolute left-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label="Next photo"
            className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      <img
        src={photo.downloadUrl}
        alt={photo.caption || ""}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100vh-8rem)] max-w-full object-contain"
      />

      {photo.caption && (
        <p
          onClick={(e) => e.stopPropagation()}
          className="mt-4 max-w-prose text-center text-sm text-white/90"
        >
          {photo.caption}
        </p>
      )}

      {photos.length > 1 && (
        <p className="mt-3 text-xs text-white/60 tabular-nums">
          {index + 1} / {photos.length}
        </p>
      )}
    </div>
  );
}
