"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteFilePhoto } from "@/app/actions/photos";

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

export function PhotoGallery({ photos, isOwner }: PhotoGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);

  if (photos.length === 0) return null;

  const selected = photos[selectedIndex];

  const handleDelete = async (photoId: string) => {
    setDeleting(photoId);
    await deleteFilePhoto(photoId);
    setDeleting(null);
    if (selectedIndex >= photos.length - 1) {
      setSelectedIndex(Math.max(0, photos.length - 2));
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Printed Photos</h2>

      {/* Main image */}
      <Card className="overflow-hidden">
        <div className="relative aspect-[4/3]">
          <img
            src={selected.downloadUrl}
            alt={selected.caption || "Printed part photo"}
            className="w-full h-full object-cover"
          />
          {selected.caption && (
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3">
              <p className="text-white text-xs">{selected.caption}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Thumbnails */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              onClick={() => setSelectedIndex(i)}
              className={`shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 transition-colors ${
                i === selectedIndex ? "border-primary" : "border-transparent"
              }`}
            >
              <img
                src={photo.downloadUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Delete button for owner */}
      {isOwner && selected && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => handleDelete(selected.id)}
          disabled={deleting === selected.id}
          className="text-destructive"
        >
          {deleting === selected.id ? "Deleting..." : "Remove photo"}
        </Button>
      )}
    </div>
  );
}
