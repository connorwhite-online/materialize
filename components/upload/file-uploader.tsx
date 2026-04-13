"use client";

import { useCallback, useState } from "react";
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
}

/**
 * Drag-and-drop / click file picker. Validates size + extension and
 * hands the raw File object back to the parent. No network calls
 * happen here — uploads are deferred until form submit so abandoned
 * sessions don't leave orphaned blobs in R2.
 */
export function FileUploader({ onFileSelected }: FileUploaderProps) {
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
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-foreground/15 bg-foreground/[0.03] p-12 text-center transition-colors hover:border-primary/50 hover:bg-foreground/[0.06] dark:border-foreground/20 dark:bg-foreground/[0.04] dark:hover:bg-foreground/[0.08]"
      >
        <input
          type="file"
          className="hidden"
          accept={acceptExtensions}
          onChange={handleChange}
        />
        <p className="text-sm font-medium">
          Drag and drop or click to upload
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          STL, OBJ, 3MF, STEP, AMF — Max 200MB
        </p>
      </label>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
