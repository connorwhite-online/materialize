"use client";

import { FileUploader } from "@/components/upload/file-uploader";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";

/**
 * Authed-home dropzone. A picked file uploads to R2, becomes a draft
 * listing, and lands on `/print/[fileAssetId]` — same chain as the
 * /print idle pane.
 */
export function HomeDropzone() {
  const { start, phase, progress, error } = useStartPrintFlow();
  const busy = phase === "uploading" || phase === "saving";

  return (
    <div className="relative">
      <FileUploader onFileSelected={(file, format) => start(file, format)} />
      {busy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-background/80 text-sm">
          <p className="font-medium">
            {phase === "uploading" ? "Uploading…" : "Saving…"}
          </p>
          {phase === "uploading" && (
            <p className="mt-1 tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
