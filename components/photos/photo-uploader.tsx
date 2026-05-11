"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "@/components/icons/image-plus";
import { addFilePhoto, addFileBuild } from "@/app/actions/photos";
import {
  addProjectPhoto,
  addProjectBuild,
} from "@/app/actions/project-photos";
import { uploadPhotoToR2, validatePhoto } from "@/lib/photos/upload-photo";
import { cn } from "@/lib/utils";

interface PhotoUploaderProps {
  targetType: "file" | "project";
  targetId: string;
  /**
   * 'creator' — owner's curator gallery (default; existing behavior).
   * 'build' — community build photo. Routes through the build-flavored
   * action, which gates on download/print for files and on
   * ownership/purchase for projects.
   */
  kind?: "creator" | "build";
  /**
   * 'sm' (default) — compact 48×48 dashed square for empty / standalone
   * placement.
   * 'lg' — fills the parent (designed for an aspect-square slot at
   * the start of a photo carousel so it sits flush with the
   * thumbnails).
   */
  size?: "sm" | "lg";
  /**
   * Allow selecting / dropping multiple images at once. Each image
   * is uploaded sequentially so the resulting filePhotos rows stay
   * in the order the user picked them.
   */
  multiple?: boolean;
}

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
  targetType,
  targetId,
  kind = "creator",
  size = "sm",
  multiple = false,
}: PhotoUploaderProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const invalid = validatePhoto(file);
      if (invalid) {
        setError(invalid);
        return;
      }

      setUploading(true);
      try {
        const { storageKey } = await uploadPhotoToR2(file);
        // Route to the action that matches both the listing kind and
        // the upload role. Four combinations; the table here makes it
        // hard to miss one.
        const result = await (async () => {
          if (targetType === "file" && kind === "creator") {
            return addFilePhoto({ fileId: targetId, storageKey });
          }
          if (targetType === "file" && kind === "build") {
            return addFileBuild({ fileId: targetId, storageKey });
          }
          if (targetType === "project" && kind === "creator") {
            return addProjectPhoto({ projectId: targetId, storageKey });
          }
          return addProjectBuild({ projectId: targetId, storageKey });
        })();
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
    [targetType, targetId, kind, router]
  );

  const uploadAll = useCallback(
    async (files: File[]) => {
      // Sequential so the resulting filePhotos rows preserve the
      // order the user picked them. Errors on one don't abort the
      // rest — each shows its own message via setError.
      for (const f of files) {
        await upload(f);
      }
    },
    [upload]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (uploading) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      void uploadAll(multiple ? files : files.slice(0, 1));
    },
    [uploadAll, uploading, multiple]
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
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) void uploadAll(files);
          // Allow re-uploading the same file(s) by clearing the input.
          e.target.value = "";
        }}
        className="hidden"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
