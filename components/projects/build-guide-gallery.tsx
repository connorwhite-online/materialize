"use client";

import { useState } from "react";
import {
  PhotoLightbox,
  type LightboxPhoto,
} from "@/components/photos/photo-lightbox";

export type GalleryImage = { src: string; alt?: string };

function toPhotos(images: GalleryImage[]): LightboxPhoto[] {
  return images.map((img, i) => ({
    id: `${i}-${img.src}`,
    downloadUrl: img.src,
    caption: img.alt || null,
  }));
}

/**
 * A row/grid of build-guide images (from an `imageGallery` block). Each
 * thumbnail opens the shared {@link PhotoLightbox} carousel scoped to the
 * gallery, so a viewer can page through that group full-screen.
 */
export function BuildGuideGallery({ images }: { images: GalleryImage[] }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  if (images.length === 0) return null;

  return (
    <>
      <div className="my-3 flex flex-wrap gap-2">
        {images.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${i}-${img.src}`}
            src={img.src}
            alt={img.alt || ""}
            loading="lazy"
            onClick={() => {
              setIndex(i);
              setOpen(true);
            }}
            className="h-40 flex-auto cursor-zoom-in rounded-xl border border-border object-cover sm:h-48"
          />
        ))}
      </div>
      {open && (
        <PhotoLightbox
          photos={toPhotos(images)}
          index={index}
          onClose={() => setOpen(false)}
          onIndexChange={setIndex}
        />
      )}
    </>
  );
}

/**
 * A single inline image that expands to the full-screen viewer on click.
 * Used for standalone (non-gallery) build-guide images.
 */
export function LightboxImage({
  src,
  alt,
  maxHeightClass = "max-h-[36rem]",
}: {
  src: string;
  alt?: string;
  maxHeightClass?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ""}
        loading="lazy"
        onClick={() => setOpen(true)}
        className={`my-3 block ${maxHeightClass} max-w-full cursor-zoom-in rounded-xl border border-border object-contain`}
      />
      {open && (
        <PhotoLightbox
          photos={[{ id: src, downloadUrl: src, caption: alt || null }]}
          index={0}
          onClose={() => setOpen(false)}
          onIndexChange={() => {}}
        />
      )}
    </>
  );
}
