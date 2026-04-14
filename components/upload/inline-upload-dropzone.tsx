"use client";

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { FileUploader } from "./file-uploader";
import { useStartPrintFlow } from "./use-start-print-flow";
import { usePendingPrintFile } from "./pending-print-file";
import { uploadFileToCraftCloud } from "@/lib/craftcloud/upload-client";
import { QuoteConfigurator } from "@/components/print/quote-configurator";

type PickedFile = {
  file: File;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
};

type DraftState =
  | { status: "uploading"; file: PickedFile }
  | {
      status: "ready";
      file: PickedFile;
      modelId: string;
      dimensions: { x: number; y: number; z: number } | null;
      volume: number | null;
    }
  | { status: "error"; file: PickedFile; message: string };

/**
 * Drop zone used on the `/print` page. The whole page is about
 * printing, so the intent is unambiguous — on file pick we go
 * straight into the configurator.
 *
 * Authed users: full R2-backed flow (presign → PUT → draft file
 * row → /print/[id]) via useStartPrintFlow. Navigates away.
 *
 * Anon users: client-side upload to CraftCloud (no R2, no DB row),
 * then QuoteConfigurator renders inline in draftMode on this same
 * page. The auth gate is deferred to "Proceed to Checkout".
 */
export function InlineUploadDropzone() {
  const { isSignedIn, isLoaded } = useUser();
  const pendingPrintFile = usePendingPrintFile();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const { start, phase, progress, error } = useStartPrintFlow();
  const started = useRef(false);

  // Consume a file stashed from the home bottom bar's "Print this
  // file" CTA. This runs once on mount — the context read-and-clears
  // so a later navigation back to /print renders the dropzone fresh.
  useEffect(() => {
    const stashed = pendingPrintFile.consume();
    if (!stashed) return;
    started.current = false;
    setDraft(null);
    setPicked(stashed);
    // Intentionally not a dependency: this is a mount-only hand-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilePicked = (
    file: File,
    format: "stl" | "obj" | "3mf" | "step" | "amf"
  ) => {
    started.current = false;
    setDraft(null);
    setPicked({ file, format });
  };

  // Authed: fire the existing R2-backed print flow the moment we
  // have a file. Anon: fire the CraftCloud direct-upload instead.
  useEffect(() => {
    if (!picked || !isLoaded) return;
    if (started.current) return;
    started.current = true;

    if (isSignedIn) {
      start(picked.file, picked.format);
      return;
    }

    // Anon draft path.
    let cancelled = false;
    setDraft({ status: "uploading", file: picked });
    (async () => {
      try {
        const model = await uploadFileToCraftCloud(picked.file, "mm");
        if (cancelled) return;
        setDraft({
          status: "ready",
          file: picked,
          modelId: model.modelId,
          dimensions: model.dimensions,
          volume: model.volume,
        });
      } catch (err) {
        if (cancelled) return;
        setDraft({
          status: "error",
          file: picked,
          message:
            err instanceof Error ? err.message : "Failed to upload file.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picked, isSignedIn, isLoaded, start]);

  // Authed upload-in-progress status card.
  if (picked && isSignedIn && (phase === "uploading" || phase === "saving")) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="mt-3 text-sm font-medium">
          {phase === "uploading"
            ? `Uploading ${picked.file.name} — ${progress}%`
            : "Preparing quote configurator…"}
        </p>
      </div>
    );
  }

  // Anon upload-in-progress status card.
  if (draft?.status === "uploading") {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="mt-3 text-sm font-medium">
          Preparing {draft.file.file.name} for manufacturing…
        </p>
      </div>
    );
  }

  // Anon draft ready — render the full configurator inline.
  if (draft?.status === "ready") {
    const geometryData = draft.dimensions
      ? {
          dimensions: draft.dimensions,
          volume: draft.volume ?? undefined,
        }
      : null;
    return (
      <QuoteConfigurator
        draftMode={{ modelId: draft.modelId, file: draft.file.file }}
        filename={draft.file.file.name}
        format={draft.file.format}
        hasCachedModel
        geometryData={geometryData}
      />
    );
  }

  return (
    <div className="space-y-3">
      <FileUploader onFileSelected={handleFilePicked} />
      {draft?.status === "error" && (
        <p className="text-xs text-destructive">{draft.message}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
