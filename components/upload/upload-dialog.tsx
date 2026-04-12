"use client";

import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileUploader } from "./file-uploader";
import { FileMetadataForm } from "./file-metadata-form";

type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

interface UploadDialogProps {
  /**
   * Trigger element rendered as the dialog's open button. Pass any
   * Button (or other clickable element) — Base UI's DialogTrigger
   * forwards onClick / open semantics to it via the `render` prop.
   */
  trigger?: React.ReactElement;
  /** Controlled open state — pass with `onOpenChange` for programmatic control. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Modal upload flow. Step 1 is the drag-and-drop file picker; once a
 * file is picked, step 2 swaps in the metadata form. The form's
 * `createFileListing` action calls `redirect()` on success, which
 * navigates the browser away from whatever page hosted the dialog —
 * the dialog itself doesn't need to handle the success path.
 */
export function UploadDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
}: UploadDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const [picked, setPicked] = useState<PickedFile | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Clear the picked file so the next open starts on the picker.
      setPicked(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:max-w-2xl"
        showCloseButton
      >
        <DialogTitle>{picked ? "New file" : "Upload a file"}</DialogTitle>
        {!picked ? (
          <FileUploader
            onFileSelected={(file, format) => setPicked({ file, format })}
          />
        ) : (
          <FileMetadataForm
            file={picked.file}
            format={picked.format}
            onCancel={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
