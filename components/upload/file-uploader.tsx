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
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-foreground/20 p-12 text-center transition-colors hover:border-foreground/40"
      >
        {uploading ? (
          <div className="w-full max-w-xs">
            <p className="text-sm text-foreground/60">Uploading...</p>
            <div className="mt-2 h-2 w-full rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-foreground transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-foreground/40">{progress}%</p>
          </div>
        ) : (
          <>
            <p className="text-foreground/60">
              Drag and drop your 3D file here, or
            </p>
            <label className="mt-2 cursor-pointer rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90">
              Choose file
              <input
                type="file"
                className="hidden"
                accept={acceptExtensions}
                onChange={handleChange}
              />
            </label>
            <p className="mt-2 text-xs text-foreground/40">
              STL, OBJ, 3MF, STEP, AMF — Max 200MB
            </p>
          </>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
