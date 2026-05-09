"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "@/components/icons/image-plus";
import { addFilePhoto, addFileMake } from "@/app/actions/photos";
import { cn } from "@/lib/utils";

interface PhotoUploaderProps {
  fileId: string;
  /**
   * 'creator' — owner's curator gallery (default; existing behavior).
   * 'make' — community build photo. Routes through `addFileMake`,
   * which gates on download/print.
   */
  kind?: "creator" | "make";
  /**
   * 'sm' (default) — compact 48×48 dashed square for empty / standalone
   * placement.
   * 'lg' — fills the parent (designed for an aspect-square slot at the
   * end of a photo carousel so it sits flush with the thumbnails).
   */
  size?: "sm" | "lg";
}

const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/**
 * Compact icon-only photo uploader. Three input modes:
 *   - click → opens the native file picker
 *   - drag → drop a file onto the icon
 *   - paste → focus the icon and Cmd/Ctrl+V an image (e.g. from
 *     a screenshot or Slack)
 *
 * No caption field — image-as-feedback is the unit of contribution
 * here. Any prose discussion belongs in the comments below.
 */
export function PhotoUploader({
  fileId,
  kind = "creator",
  size = "sm",
}: PhotoUploaderProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      // Client-side gates so we don't waste a presign round-trip on
      // obvious-fail uploads. The server validates again.
      if (!ACCEPTED_MIME.has(file.type.toLowerCase())) {
        setError("JPG, PNG, or WEBP only.");
        return;
      }
      if (file.size > MAX_PHOTO_SIZE) {
        setError("Photo exceeds 10MB.");
        return;
      }

      setUploading(true);
      try {
        const presignRes = await fetch("/api/upload/photo-presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name || "pasted-image",
            contentType: file.type,
            fileSize: file.size,
          }),
        });

        if (!presignRes.ok) {
          const data = await presignRes.json().catch(() => ({}));
          throw new Error(
            data.error || `Failed to get upload URL (${presignRes.status})`
          );
        }

        const { uploadUrl, storageKey } = (await presignRes.json()) as {
          uploadUrl: string;
          storageKey: string;
        };

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) {
          throw new Error(`R2 upload failed (${putRes.status})`);
        }

        const action = kind === "make" ? addFileMake : addFilePhoto;
        const result = await action({ fileId, storageKey });
        if (result && "error" in result) {
          throw new Error(result.error);
        }

        // Surfacing the new photo without a hard reload — the server
        // action already revalidates the path.
        router.refresh();
      } catch (err) {
        console.error("Photo upload failed:", err);
        setError(
          err instanceof Error ? err.message : "Photo upload failed."
        );
      } finally {
        setUploading(false);
      }
    },
    [fileId, kind, router]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (uploading) return;
      const file = e.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload, uploading]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (uploading) return;
      for (const item of e.clipboardData.items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void upload(file);
            return;
          }
        }
      }
    },
    [upload, uploading]
  );

  const isLarge = size === "lg";
  return (
    <div className={cn("space-y-1.5", isLarge && "h-full w-full")}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        disabled={uploading}
        aria-label="Add photo (click, drag, or paste)"
        title="Click, drag, or paste an image"
        className={cn(
          "cursor-pointer rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground transition-colors outline-none flex items-center justify-center",
          isLarge
            ? "h-full w-full flex-col gap-2"
            : "h-12 w-12",
          "hover:border-foreground/40 hover:text-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          dragOver && "border-primary bg-primary/10 text-primary",
          uploading && "animate-pulse"
        )}
      >
        <ImagePlus size={isLarge ? 28 : 20} />
        {isLarge && <span className="text-xs font-medium">Add photo</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          // Allow re-uploading the same file by clearing the input.
          e.target.value = "";
        }}
        className="hidden"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
