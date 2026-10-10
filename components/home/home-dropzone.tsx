"use client";

import Link from "next/link";
import { FolderOpenIcon, LayersIcon } from "lucide-react";
import { FileUploader } from "@/components/upload/file-uploader";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";
import { Button } from "@/components/ui/button";

/**
 * Authed-home create cluster: a featured file dropzone (uploads to R2,
 * becomes a draft listing, lands on `/print/[fileAssetId]` — same chain
 * as the /print idle pane) plus New Project / New Collection. Both
 * navigate to their create pages (`/projects/new`, `/collections/new`).
 */
export function HomeDropzone() {
  const { start, phase, progress, error } = useStartPrintFlow();
  const busy = phase === "uploading" || phase === "saving";

  return (
    <div>
      <div className="relative" aria-busy={busy}>
        {/* Always mounted so screen readers announce phase changes. */}
        <p role="status" className="sr-only">
          {phase === "uploading"
            ? "Uploading file"
            : phase === "saving"
              ? "Saving file"
              : ""}
        </p>
        <FileUploader onFileSelected={(file, format) => start(file, format)} />
        {busy && (
          <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center rounded-2xl bg-background/80 text-sm">
            <p className="font-medium" aria-hidden>
              {phase === "uploading" ? "Uploading…" : "Saving…"}
            </p>
            {phase === "uploading" && (
              <progress
                className="sr-only"
                aria-label="Upload progress"
                max={100}
                value={Math.round(progress)}
              />
            )}
            {phase === "uploading" && (
              <p className="mt-1 tabular-nums text-muted-foreground" aria-hidden>
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

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="lg"
          className="h-11 min-w-0 w-full"
          render={<Link href="/projects/new" />}
        >
          <LayersIcon className="size-4" />
          New Project
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-11 min-w-0 w-full"
          render={<Link href="/collections/new" />}
        >
          <FolderOpenIcon className="size-4" />
          New Collection
        </Button>
      </div>
    </div>
  );
}
