"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "@/components/icons/x";
import { ChevronLeft } from "@/components/icons/chevron-left";
import { ChevronRight } from "@/components/icons/chevron-right";
import { DeletePhotoButton } from "./delete-photo-button";

interface Photo {
  id: string;
  storageKey: string;
  caption: string | null;
  downloadUrl: string;
}

interface PhotoGalleryProps {
  photos: Photo[];
  isOwner: boolean;
}

/**
 * Curator photo gallery for a file. Renders as a horizontal
 * scroll-snapping carousel of square thumbnails; clicking any
 * thumbnail opens the lightbox at that index, where the photo is
 * shown at its native aspect ratio over a dark backdrop. Owners
 * see a corner-X delete button on every thumbnail.
 */
export function PhotoGallery({ photos, isOwner }: PhotoGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Printed Photos</h2>

      {/* Horizontal scroll carousel. snap-x snap-mandatory keeps the
          row honest about which thumbnail is "active" on swipe.
          aspect-square gives every photo the same crop frame so the
          row reads as a uniform rhythm regardless of source aspect. */}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory">
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="relative shrink-0 aspect-square w-32 sm:w-40 snap-start overflow-hidden rounded-xl border border-border bg-muted/30"
          >
            <button
              type="button"
              onClick={() => setLightboxIndex(i)}
              className="absolute inset-0 cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={photo.caption || `Photo ${i + 1}`}
            >
              <img
                src={photo.downloadUrl}
                alt={photo.caption || ""}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
            {isOwner && <DeletePhotoButton photoId={photo.id} />}
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}

interface LightboxProps {
  photos: Photo[];
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
