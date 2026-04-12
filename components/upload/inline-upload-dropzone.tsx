"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileUploader } from "./file-uploader";
import { FileMetadataForm } from "./file-metadata-form";

type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

/**
 * Inline drag-and-drop dropzone that, when a file is picked, opens
 * the metadata form in a dialog. Used on the print page so the
 * "upload a new file" affordance lives directly in the page layout
 * instead of being a CTA card linking out to a separate route.
 */
export function InlineUploadDropzone() {
  const [picked, setPicked] = useState<PickedFile | null>(null);

  const handleClose = () => setPicked(null);

  return (
    <>
      <FileUploader
        onFileSelected={(file, format) => setPicked({ file, format })}
      />
      <Dialog
        open={picked !== null}
        onOpenChange={(next) => {
          if (!next) handleClose();
        }}
      >
        <DialogContent
          className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl"
          showCloseButton
        >
          <DialogTitle>New file</DialogTitle>
          {picked && (
            <FileMetadataForm
              file={picked.file}
              format={picked.format}
              onCancel={handleClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
