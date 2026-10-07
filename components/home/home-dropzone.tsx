"use client";

import Link from "next/link";
import { FolderOpenIcon, LayersIcon } from "lucide-react";
import { FileUploader } from "@/components/upload/file-uploader";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";
import { Button } from "@/components/ui/button";

/**
 * Authed-home create cluster: a featured file dropzone (uploads to R2,
 * becomes a draft listing, lands on `/print/[fileAssetId]` — same chain
 * as the /print idle pane) plus New project / New collection. Both
 * navigate to their create pages (`/projects/new`, `/collections/new`).
 */
export function HomeDropzone({
  showCreateActions = true,
}: {
  /**
   * Show the New project / New collection pair under the dropzone.
   * The signed-in home dashboard renders its own quick-actions row
   * and passes `false`.
   */
  showCreateActions?: boolean;
} = {}) {
  const { start, phase, progress, error } = useStartPrintFlow();
  const busy = phase === "uploading" || phase === "saving";

  return (
    <div>
      <div className="relative">
        <FileUploader onFileSelected={(file, format) => start(file, format)} />
        {busy && (
          <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center rounded-2xl bg-background/80 text-sm">
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

      {showCreateActions && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" render={<Link href="/projects/new" />}>
            <LayersIcon className="size-4" />
            New project
          </Button>
          <Button variant="secondary" render={<Link href="/collections/new" />}>
            <FolderOpenIcon className="size-4" />
            New collection
          </Button>
        </div>
      )}
    </div>
  );
}
