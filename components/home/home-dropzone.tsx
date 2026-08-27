"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderOpenIcon, LayersIcon } from "lucide-react";
import { FileUploader } from "@/components/upload/file-uploader";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";
import { Button } from "@/components/ui/button";
import { NewCollectionDialog } from "@/components/profile/new-collection-dialog";
import { DropzonePrimitives } from "@/components/home/dropzone-primitives-lazy";

/**
 * Authed-home create cluster: a featured file dropzone (uploads to R2,
 * becomes a draft listing, lands on `/print/[fileAssetId]` — same chain
 * as the /print idle pane) plus New Project / New Collection. Project
 * navigates to `/projects/new`; collection opens the existing dialog.
 */
export function HomeDropzone() {
  const { start, phase, progress, error } = useStartPrintFlow();
  const [collectionOpen, setCollectionOpen] = useState(false);
  const busy = phase === "uploading" || phase === "saving";

  return (
    <div>
      <div className="relative">
        <FileUploader
          featured
          title="Add a File"
          backdrop={<DropzonePrimitives />}
          onFileSelected={(file, format) => start(file, format)}
        />
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
          type="button"
          variant="outline"
          size="lg"
          className="h-11 min-w-0 w-full"
          onClick={() => setCollectionOpen(true)}
        >
          <FolderOpenIcon className="size-4" />
          New Collection
        </Button>
      </div>

      <NewCollectionDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
      />
    </div>
  );
}
