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
    format: "stl" | "obj" | "3mf" | "step" | "amf"
  ) => void;
  /** Headline inside the drop area. Featured default: "Add a File". */
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
  const resolvedTitle = title ?? (featured ? "Add a File" : "Drag and drop or click to upload");
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
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const acceptExtensions = ACCEPTED_FORMATS.map((f) => `.${f}`).join(",");

  return (
    <div>
      <label
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={cn(
          "group/drop flex cursor-pointer flex-col items-center justify-center border-2 border-dashed text-center transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          featured
            ? "relative min-h-[7.5rem] overflow-hidden rounded-2xl border-foreground/15 bg-foreground/[0.03] px-5 py-6 hover:border-primary/50 dark:border-foreground/20 dark:bg-foreground/[0.035] dark:hover:border-primary/40 sm:min-h-[8rem] sm:py-7"
            : "rounded-xl border-foreground/15 bg-foreground/[0.03] p-12 hover:border-primary/50 hover:bg-foreground/[0.06] dark:border-foreground/20 dark:bg-foreground/[0.04] dark:hover:bg-foreground/[0.08]"
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
          <span
            className={cn(
              "relative z-[2] inline-flex items-center justify-center rounded-full",
              // Muted chip — design-system fill that still reads against
              // the light well (secondary/75 washed out on the dashed card).
              "bg-muted px-4 py-2 text-sm font-semibold tracking-tight text-foreground",
              "ring-1 ring-inset ring-border",
              "shadow-sm",
              "transition-colors group-hover/drop:bg-muted/80 group-hover/drop:shadow"
            )}
          >
            {resolvedTitle}
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
