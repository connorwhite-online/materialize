"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { addFilePhoto } from "@/app/actions/photos";

interface PhotoUploaderProps {
  fileId: string;
}

const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function PhotoUploader({ fileId }: PhotoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);

    // Client-side gates so we don't waste a presign round-trip on
    // obvious-fail uploads. The server validates again.
    if (!ACCEPTED_MIME.has(file.type.toLowerCase())) {
      setErrorMessage("Only JPG, PNG, or WEBP images are accepted.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setErrorMessage("Photo exceeds 10MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const presignRes = await fetch("/api/upload/photo-presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
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

      const result = await addFilePhoto({
        fileId,
        storageKey,
        caption: caption || undefined,
      });
      if (result && "error" in result) {
        throw new Error(result.error);
      }

      setCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error("Photo upload failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Photo upload failed."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Add a photo of your print</p>
      <Input
        placeholder="Caption (optional)"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={500}
      />
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleUpload}
          disabled={uploading}
          className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
      </div>
      {uploading && (
        <p className="text-xs text-muted-foreground">Uploading photo...</p>
      )}
      {errorMessage && (
        <p className="text-xs text-destructive">{errorMessage}</p>
      )}
    </div>
  );
}
