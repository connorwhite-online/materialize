"use client";

import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_FORMATS,
  MAX_FILE_SIZE,
  fileExtensionToFormat,
} from "@/lib/validations/file";
import { DropzonePrimitives } from "@/components/home/dropzone-primitives-lazy";

interface FileUploaderProps {
  /**
   * Called when the user picks a valid file. The file stays in client
   * memory — it isn't uploaded to R2 until the metadata form is saved.
   */
  onFileSelected: (
    file: File,
    format: "stl" | "obj" | "3mf" | "step" | "amf",
  ) => void;
  /** Headline inside the drop area. Featured default: "Drop a 3D model here". */
  title?: string;
  /** Muted line under the headline (compact variant only). */
  subtitle?: string;
  /**
   * Featured well with material backdrop + button-style title.
   * Default for every general file drop (home, /print, dialogs).
   * Pass `false` for a dense compact box without WebGL.
   */
  featured?: boolean;
  /**
   * Absolutely positioned behind the copy. Decorative only.
   * Featured defaults to the floating print-material primitives;
   * pass `null` to suppress them while keeping the featured well.
   */
  backdrop?: ReactNode | null;
}

/**
 * Drag-and-drop / click file picker. Validates size + extension and
 * hands the raw File object back to the parent. No network calls
 * happen here — uploads are deferred until form submit so abandoned
 * sessions don't leave orphaned blobs in R2.
 */
export function FileUploader({
  onFileSelected,
  title,
  subtitle = "STL, OBJ, 3MF, STEP, AMF — Max 200MB",
  featured = true,
  backdrop,
}: FileUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const resolvedTitle =
    title ??
    (featured ? "Drop a 3D model here" : "Drag and drop or click to upload");
  const resolvedBackdrop =
    featured && backdrop === undefined ? <DropzonePrimitives /> : backdrop;

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (file.size > MAX_FILE_SIZE) {
        setError("File exceeds 200MB limit");
        return;
      }

      const format = fileExtensionToFormat(file.name);
      if (!format) {
        setError("Unsupported file format. Accepted: STL, OBJ, 3MF, STEP, AMF");
        return;
      }

      onFileSelected(file, format);
    },
    [onFileSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const acceptExtensions = ACCEPTED_FORMATS.map((f) => `.${f}`).join(",");

  return (
    <div>
      <label
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          // Only when the pointer leaves the well, not a child.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        data-dragging={dragging || undefined}
        className={cn(
          "group/drop flex cursor-pointer flex-col items-center justify-center border border-dashed text-center transition-[background-color,border-color] duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          featured
            ? "relative min-h-[15rem] justify-end overflow-hidden rounded-2xl border-foreground/15 bg-muted/60 px-6 pt-28 pb-7 hover:border-foreground/30 data-[dragging]:border-foreground/40 data-[dragging]:bg-muted sm:min-h-[17rem]"
            : "rounded-xl border-foreground/15 bg-muted/60 p-12 hover:border-foreground/30 hover:bg-muted data-[dragging]:border-foreground/40 data-[dragging]:bg-muted",
        )}
      >
        {resolvedBackdrop}
        <input
          type="file"
          className="sr-only"
          accept={acceptExtensions}
          onChange={handleChange}
        />
        {featured ? (
          <span className="relative z-[2] flex flex-col items-center gap-3">
            <span className="text-base leading-6 font-semibold text-foreground">
              {dragging ? "Drop to get quotes" : resolvedTitle}
            </span>
            {/* Looks like a button; the whole well is the control. */}
            <span
              aria-hidden="true"
              className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity duration-150 group-hover/drop:opacity-90"
            >
              Choose file
            </span>
            <span className="text-xs text-subtle-foreground">
              STL, OBJ, 3MF, STEP or AMF · up to 200 MB
            </span>
          </span>
        ) : (
          <>
            <p className="text-sm font-medium">{resolvedTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </>
        )}
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
