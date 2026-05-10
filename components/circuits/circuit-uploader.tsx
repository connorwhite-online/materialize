"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "@/components/icons/image-plus";
import { addProjectCircuitImage } from "@/app/actions/circuits";
import {
  uploadCircuitToR2,
  validateCircuitImage,
} from "@/lib/circuits/upload-circuit";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  /**
   * 'sm' — compact 48×48 dashed square for empty placement.
   * 'lg' — fills the parent (designed for an aspect-square slot at
   *        the start of the circuit gallery so it sits flush with the
   *        existing diagram tiles).
   */
  size?: "sm" | "lg";
  multiple?: boolean;
}

/**
 * Click / drag / paste uploader for circuit diagrams. Models on the
 * photo uploader — same input modes, same look. Phase 1 accepts image
 * formats only (PNG/SVG/JPG/WEBP); later phases will surface separate
 * affordances for Fritzing/KiCad source uploads (and probably a
 * separate "+ Wokwi link" button alongside).
 */
export function CircuitUploader({
  projectId,
  size = "sm",
  multiple = false,
}: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const invalid = validateCircuitImage(file);
      if (invalid) {
        setError(invalid);
        return;
      }
      setUploading(true);
      try {
        const { storageKey } = await uploadCircuitToR2(file);
        const result = await addProjectCircuitImage({
          projectId,
          storageKey,
          originalFilename: file.name,
        });
        if (result && "error" in result) {
          throw new Error(result.error);
        }
        router.refresh();
      } catch (err) {
        console.error("Circuit upload failed:", err);
        setError(
          err instanceof Error ? err.message : "Upload failed."
        );
      } finally {
        setUploading(false);
      }
    },
    [projectId, router]
  );

  const uploadAll = useCallback(
    async (files: File[]) => {
      for (const f of files) await upload(f);
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
        aria-label="Add diagram (click, drag, or paste)"
        title="Click, drag, or paste a wiring diagram"
        className={cn(
          "cursor-pointer rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground transition-colors outline-none flex items-center justify-center",
          isLarge ? "h-full w-full flex-col gap-2" : "h-12 w-12",
          "hover:border-foreground/40 hover:text-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          dragOver && "border-primary bg-primary/10 text-primary",
          uploading && "animate-pulse"
        )}
      >
        <ImagePlus size={isLarge ? 28 : 20} />
        {isLarge && <span className="text-xs font-medium">Add diagram</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) void uploadAll(files);
          e.target.value = "";
        }}
        className="hidden"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
