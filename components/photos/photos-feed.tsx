"use client";

import { useState } from "react";
import { UserAvatar } from "@/components/auth/user-avatar";
import { PhotoUploader } from "./photo-uploader";
import { DeletePhotoButton } from "./delete-photo-button";
import { PhotoLightbox } from "./photo-lightbox";
import { timeAgo } from "@/lib/utils/time";

export type FeedPhoto = {
  id: string;
  downloadUrl: string;
  caption: string | null;
  createdAt: Date | string;
  /** "creator" = listing-owner curator photo; "build" = community print. */
  kind: "creator" | "build";
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
  /** Which kind of listing the feed is attached to. Drives both the
   * upload routing (file vs project actions) and the delete routing. */
  targetType: "file" | "project";
  targetId: string;
  /** Listing owner; can delete any photo on the listing. */
  ownerId: string;
  viewerId: string | null;
  /**
   * What action the trailing uploader fires. Omit (or pass null /
   * undefined) to hide the uploader for viewers who can't post —
   * anon visitors and signed-in non-printers.
   */
  uploadAs?: "creator" | "build" | null;
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
  targetType,
  targetId,
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
        <PhotoUploader
          targetType={targetType}
          targetId={targetId}
          kind={uploadAs}
          size="sm"
        />
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
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Add-tile sits first so the affordance is the first thing
            the eye lands on instead of being chased to the end of a
            potentially-long carousel. Multi-select so an owner can
            drop a stack of build photos in one go. */}
        {uploadAs && (
          <div className="shrink-0 aspect-square w-32 sm:w-40 snap-start">
            <PhotoUploader
              targetType={targetType}
              targetId={targetId}
              kind={uploadAs}
              size="lg"
              multiple
            />
          </div>
        )}
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
              targetType={targetType}
            />
          );
        })}
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
  targetType: "file" | "project";
}

function PhotoThumb({
  photo,
  index,
  onOpen,
  canDelete,
  targetType,
}: PhotoThumbProps) {
  // Anchor for direct deep-links coming from the bell ("added a
  // photo" notifications point at #build-<id>). Only set on community
  // photos for backward compatibility with the existing notification
  // payload shape.
  const id = photo.kind === "build" ? `build-${photo.id}` : undefined;

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
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </button>

      {/* Author byline overlay — community photos only. Creator
          photos render bare since the byline is implicit in the
          listing's action card. pointer-events-none so the click
          falls through to the lightbox-opening button. */}
      {photo.kind === "build" && photo.author && (
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

      {canDelete && (
        <DeletePhotoButton photoId={photo.id} targetType={targetType} />
      )}
    </div>
  );
}
