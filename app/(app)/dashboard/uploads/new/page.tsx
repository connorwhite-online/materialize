"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { FileUploader } from "@/components/upload/file-uploader";
import { FileMetadataForm } from "@/components/upload/file-metadata-form";

interface UploadedAsset {
  id: string;
  storageKey: string;
  originalFilename: string;
  format: string;
  fileSize: number;
}

type Phase = "picking" | "preparing" | "ready";

export default function NewUploadPage() {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [phase, setPhase] = useState<Phase>("picking");
  const searchParams = useSearchParams();

  // If we landed here via the home bottom bar, asset is encoded in query
  useEffect(() => {
    const encoded = searchParams.get("asset");
    if (encoded) {
      try {
        const asset = JSON.parse(decodeURIComponent(encoded));
        setAssets([asset]);
        setPhase("preparing");
      } catch {
        // invalid payload
      }
    }
  }, [searchParams]);

  // Transition from "preparing" to "ready" after a brief moment so we can
  // show a spinner between "upload complete" and "form visible"
  useEffect(() => {
    if (phase !== "preparing") return;
    const id = setTimeout(() => setPhase("ready"), 400);
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Upload a File</h1>

      {phase === "picking" && (
        <div className="mt-6">
          <FileUploader
            onUploadComplete={(asset) => {
              setAssets((prev) => [...prev, asset]);
              setPhase("preparing");
            }}
          />
        </div>
      )}

      {phase === "preparing" && (
        <div className="mt-16 flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="text-sm text-muted-foreground">Preparing preview...</p>
        </div>
      )}

      {phase === "ready" && assets.length > 0 && (
        <div className="mt-6">
          <FileMetadataForm assets={assets} />
        </div>
      )}
    </div>
  );
}
