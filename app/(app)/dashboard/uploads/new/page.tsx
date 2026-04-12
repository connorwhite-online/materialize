"use client";

import { useState } from "react";
import { FileUploader } from "@/components/upload/file-uploader";
import { FileMetadataForm } from "@/components/upload/file-metadata-form";

type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

export default function NewUploadPage() {
  const [picked, setPicked] = useState<PickedFile | null>(null);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Upload a File</h1>

      {!picked && (
        <div className="mt-6">
          <FileUploader
            onFileSelected={(file, format) => setPicked({ file, format })}
          />
        </div>
      )}

      {picked && (
        <div className="mt-6">
          <FileMetadataForm file={picked.file} format={picked.format} />
        </div>
      )}
    </div>
  );
}
