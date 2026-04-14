"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "@/components/icons/chevron-right";
import { XIcon } from "lucide-react";
import { FileUploader } from "@/components/upload/file-uploader";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";
import { usePendingPrintFile } from "@/components/upload/pending-print-file";
import { uploadFileToCraftCloud } from "@/lib/craftcloud/upload-client";
import { QuoteConfigurator } from "@/components/print/quote-configurator";

type Format = "stl" | "obj" | "3mf" | "step" | "amf";

interface LibraryTile {
  fileAssetId: string;
  name: string;
  thumbnailUrl: string | null;
  format: string;
  source: "owned" | "purchased";
}

interface PrintPageContentProps {
  headline: string;
  subheadline: string;
  tiles: LibraryTile[];
  linkSuffix: string;
}

type PickedFile = { file: File; format: Format };

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
 * Client shell for the /print page. Switches between two layouts:
 *
 *   1. Idle — header, library tiles, "upload a new file" dropzone,
 *      "browse the marketplace" link. This is what the user sees
 *      when they land on /print with no file active.
 *
 *   2. Active — a compact file-context bar ("Printing foo.stl · ×")
 *      sitting where the header was, with the QuoteConfigurator
 *      below it. The library tiles and upload prompt get out of the
 *      way so the configurator has the page to itself.
 *
 * Absorbed the draft state machine that previously lived in
 * InlineUploadDropzone — anon users upload client-side to CraftCloud
 * and stay on this page in draft mode; authed users fire the
 * existing useStartPrintFlow which navigates to /print/[id].
 */
export function PrintPageContent({
  headline,
  subheadline,
  tiles,
  linkSuffix,
}: PrintPageContentProps) {
  const { isSignedIn, isLoaded } = useUser();
  const pendingPrintFile = usePendingPrintFile();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const { start, phase, progress, error } = useStartPrintFlow();
  const started = useRef(false);

  // Consume a file stashed from the home bar's "Print this file" CTA.
  useEffect(() => {
    const stashed = pendingPrintFile.consume();
    if (!stashed) return;
    started.current = false;
    setDraft(null);
    setPicked(stashed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilePicked = (file: File, format: Format) => {
    started.current = false;
    setDraft(null);
    setPicked({ file, format });
  };

  const handleReset = () => {
    started.current = false;
    setPicked(null);
    setDraft(null);
  };

  // Authed: kick off R2-backed flow. Anon: upload straight to
  // CraftCloud and render the configurator inline.
  useEffect(() => {
    if (!picked || !isLoaded) return;
    if (started.current) return;
    started.current = true;

    if (isSignedIn) {
      start(picked.file, picked.format);
      return;
    }

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

  // Active states — we're either uploading or rendering the
  // configurator. Either way, hide the idle chrome.
  const authedActive =
    picked && isSignedIn && (phase === "uploading" || phase === "saving");
  const anonUploading = draft?.status === "uploading";
  const anonReady = draft?.status === "ready";
  const isActive = authedActive || anonUploading || anonReady;

  if (isActive && picked) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <FileContextBar
          file={picked.file}
          format={picked.format}
          onReset={handleReset}
          statusLabel={
            authedActive
              ? phase === "uploading"
                ? `Uploading · ${progress}%`
                : "Preparing…"
              : anonUploading
                ? "Preparing for manufacturing…"
                : null
          }
        />

        {anonReady && draft?.status === "ready" && (
          <div className="mt-6">
            <QuoteConfigurator
              draftMode={{ modelId: draft.modelId, file: draft.file.file }}
              filename={draft.file.file.name}
              format={draft.file.format}
              hasCachedModel
              geometryData={
                draft.dimensions
                  ? {
                      dimensions: draft.dimensions,
                      volume: draft.volume ?? undefined,
                    }
                  : null
              }
            />
          </div>
        )}

        {authedActive && (
          <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            <p className="mt-3 text-sm font-medium">
              {phase === "uploading"
                ? `Uploading ${picked.file.name} — ${progress}%`
                : "Preparing quote configurator…"}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold">{headline}</h1>
      <p className="mt-2 text-muted-foreground">{subheadline}</p>

      {tiles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            From your library
          </h2>
          <div className="mt-3 grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {tiles.map((tile) => (
              <Link
                key={tile.fileAssetId}
                href={`/print/${tile.fileAssetId}${linkSuffix}`}
                className="group"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30 transition-colors group-hover:border-primary/40">
                  {tile.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground/40">
                      .{tile.format}
                    </div>
                  )}
                  {tile.source === "purchased" && (
                    <Badge
                      variant="secondary"
                      className="absolute left-1 top-1 text-[9px]"
                    >
                      Purchased
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs text-foreground/80 group-hover:text-primary">
                  {tile.name}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">
          {tiles.length > 0 ? "Or upload a new file" : "Upload a file"}
        </h2>
        <div className="mt-3 space-y-3">
          <FileUploader onFileSelected={handleFilePicked} />
          {draft?.status === "error" && (
            <p className="text-xs text-destructive">{draft.message}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>

      <div className="mt-8">
        <Link
          href="/files"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          Or browse the marketplace
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function FileContextBar({
  file,
  format,
  onReset,
  statusLabel,
}: {
  file: File;
  format: Format;
  onReset: () => void;
  statusLabel?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        .{format}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {statusLabel ?? `${formatSize(file.size)} · .${format}`}
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        aria-label="Use a different file"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
