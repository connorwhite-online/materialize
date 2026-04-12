"use client";

import { useState, useCallback } from "react";
import { ACCEPTED_FORMATS, MAX_FILE_SIZE } from "@/lib/validations/file";

interface UploadedAsset {
  id: string;
  storageKey: string;
  originalFilename: string;
  format: string;
  fileSize: number;
}

interface FileUploaderProps {
  onUploadComplete: (asset: UploadedAsset) => void;
}

export function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      setProgress(0);

      try {
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          throw new Error("File exceeds 200MB limit");
        }

        // Get presigned URL
        const presignRes = await fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            fileSize: file.size,
          }),
        });

        if (!presignRes.ok) {
          const data = await presignRes.json();
          throw new Error(data.error || "Failed to get upload URL");
        }

        const { uploadUrl, storageKey, format } = await presignRes.json();

        // Upload directly to R2
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        await new Promise<void>((resolve, reject) => {
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error("Upload failed"));
            }
          });
          xhr.addEventListener("error", () => reject(new Error("Upload failed")));
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader(
            "Content-Type",
            file.type || "application/octet-stream"
          );
          xhr.send(file);
        });

        // Record the upload
        const completeRes = await fetch("/api/upload/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey,
            originalFilename: file.name,
            format,
            fileSize: file.size,
          }),
        });

        if (!completeRes.ok) {
          throw new Error("Failed to record upload");
        }

        const { asset } = await completeRes.json();
        onUploadComplete(asset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const acceptExtensions = ACCEPTED_FORMATS.map((f) => `.${f}`).join(",");

  return (
    <div>
      <label
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-12 text-center transition-colors hover:border-primary/40 hover:bg-muted/50"
      >
        <input
          type="file"
          className="hidden"
          accept={acceptExtensions}
          onChange={handleChange}
          disabled={uploading}
        />
        {uploading ? (
          <div className="w-full max-w-xs">
            <p className="text-sm text-muted-foreground">Uploading...</p>
            <div className="mt-2 h-2 w-full rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drag and drop or click to upload
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              STL, OBJ, 3MF, STEP, AMF — Max 200MB
            </p>
          </>
        )}
      </label>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
