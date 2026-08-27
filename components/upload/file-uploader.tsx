"use client";

import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_FORMATS,
  MAX_FILE_SIZE,
  fileExtensionToFormat,
} from "@/lib/validations/file";

interface FileUploaderProps {
  /**
   * Called when the user picks a valid file. The file stays in client
   * memory — it isn't uploaded to R2 until the metadata form is saved.
   */
  onFileSelected: (
    file: File,
    format: "stl" | "obj" | "3mf" | "step" | "amf"
  ) => void;
  /** Headline inside the drop area. */
  title?: string;
  /** Muted line under the headline. */
  subtitle?: string;
  /**
   * Authed-home treatment: taller rounded well with room for a
   * decorative backdrop. Other surfaces keep the compact dashed box.
   */
  featured?: boolean;
  /** Absolutely positioned behind the copy. Decorative only. */
  backdrop?: ReactNode;
}

/**
 * Drag-and-drop / click file picker. Validates size + extension and
 * hands the raw File object back to the parent. No network calls
 * happen here — uploads are deferred until form submit so abandoned
 * sessions don't leave orphaned blobs in R2.
 */
export function FileUploader({
  onFileSelected,
  title = "Drag and drop or click to upload",
  subtitle = "STL, OBJ, 3MF, STEP, AMF — Max 200MB",
  featured = false,
  backdrop,
}: FileUploaderProps) {
  const [error, setError] = useState<string | null>(null);

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
            ? "relative min-h-[11.5rem] overflow-hidden rounded-2xl border-foreground/15 bg-foreground/[0.03] px-6 py-10 hover:border-primary/50 dark:border-foreground/20 dark:bg-foreground/[0.035] dark:hover:border-primary/40 sm:min-h-[12.5rem]"
            : "rounded-xl border-foreground/15 bg-foreground/[0.03] p-12 hover:border-primary/50 hover:bg-foreground/[0.06] dark:border-foreground/20 dark:bg-foreground/[0.04] dark:hover:bg-foreground/[0.08]"
        )}
      >
        {backdrop}
        <input
          type="file"
          className="sr-only"
          accept={acceptExtensions}
          onChange={handleChange}
        />
        {featured ? (
          // Opaque-enough plate around the copy only. Nav `.glass-surface`
          // is ~82% translucent and lets highlights punch through the
          // letters; this mix stays frosted without losing contrast.
          // No `bg-*` utility — that would fight a future glass class.
          <span className="relative z-[2] flex flex-col items-center rounded-2xl px-5 py-3 text-foreground shadow-sm ring-1 ring-foreground/10 [background-color:color-mix(in_oklab,var(--background)_92%,transparent)] backdrop-blur-md">
            <p className="text-base font-medium tracking-tight">{title}</p>
            <p className="mt-1 text-xs text-foreground/70">{subtitle}</p>
          </span>
        ) : (
          <>
            <p className="text-sm font-medium">{title}</p>
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
