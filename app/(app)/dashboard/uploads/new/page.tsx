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

export default function NewUploadPage() {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const searchParams = useSearchParams();

  // If we landed here via the home bottom bar, asset data is encoded in query
  useEffect(() => {
    const encoded = searchParams.get("asset");
    if (encoded) {
      try {
        const asset = JSON.parse(decodeURIComponent(encoded));
        setAssets([asset]);
      } catch {
        // invalid payload, ignore
      }
    }
  }, [searchParams]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Upload a File</h1>

      {assets.length === 0 && (
        <div className="mt-6">
          <FileUploader
            onUploadComplete={(asset) =>
              setAssets((prev) => [...prev, asset])
            }
          />
        </div>
      )}

      {assets.length > 0 && (
        <div className="mt-6">
          <FileMetadataForm assets={assets} />
        </div>
      )}
    </div>
  );
}
