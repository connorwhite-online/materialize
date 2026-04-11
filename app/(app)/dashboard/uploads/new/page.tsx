"use client";

import { useState } from "react";
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Upload a File</h1>

      <div className="mt-6">
        <FileUploader
          onUploadComplete={(asset) =>
            setAssets((prev) => [...prev, asset])
          }
        />
      </div>

      {assets.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Listing Details</h2>
          <div className="mt-4">
            <FileMetadataForm assets={assets} />
          </div>
        </div>
      )}
    </div>
  );
}
