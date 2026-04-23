"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { XIcon } from "lucide-react";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";
import { usePendingPrintFile } from "@/components/upload/pending-print-file";
import { uploadFileToCraftCloud } from "@/lib/craftcloud/upload-client";
import { QuoteConfigurator } from "@/components/print/quote-configurator";
import { WhatNextPane } from "@/components/print/what-next-pane";
import { CartSlotStack } from "@/components/print/cart-slot-stack";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Format = "stl" | "obj" | "3mf" | "step" | "amf";
type Unit = "mm" | "cm" | "in";

const UNIT_STORAGE_KEY = "print-source-unit";
const UNIT_VALUES: ReadonlySet<Unit> = new Set(["mm", "cm", "in"]);

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
  /**
   * CraftCloud material id from /materials/[slug] → "Print with X".
   * Forwarded to QuoteConfigurator once a file is picked so the
   * material step gets auto-advanced.
   */
  preselectMaterialId?: string;
  /**
   * Vendor id to expand in the cart stack on initial render —
   * forwarded from a `?expand=<vendorId>` query param set by the
   * authed /print/[fileAssetId] page after a successful Add to
   * Cart, so the just-added slot surfaces its line items without
   * the user having to click.
   */
  initialExpandVendorId?: string;
}

type PickedFile = { file: File; format: Format };

type DraftState =
  | { status: "uploading"; file: PickedFile; unit: Unit }
  | {
      status: "ready";
      file: PickedFile;
      unit: Unit;
      modelId: string;
      dimensions: { x: number; y: number; z: number } | null;
      volume: number | null;
    }
  | { status: "error"; file: PickedFile; unit: Unit; message: string };

/**
 * Client shell for the /print page. One layout, two content modes:
 *
 *   • Idle — WhatNextPane (uploader + collapsed recent files) on
 *     the left, CartSlotStack on the right. The user sees their
 *     existing vendor carts immediately so they can resume or
 *     remove an in-flight order without hunting for it.
 *
 *   • Active — a FileContextBar + QuoteConfigurator replace the
 *     WhatNextPane on the left while the cart stack stays put on
 *     the right (prior vendor groups visible + collapsible). After
 *     a successful Add to Cart we fall back to Idle with the just
 *     added vendor slot expanded.
 */
export function PrintPageContent({
  headline,
  subheadline,
  tiles,
  linkSuffix,
  preselectMaterialId,
  initialExpandVendorId,
}: PrintPageContentProps) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const pendingPrintFile = usePendingPrintFile();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [unit, setUnit] = useState<Unit>("mm");
  const [unitHydrated, setUnitHydrated] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(UNIT_STORAGE_KEY);
      if (stored && UNIT_VALUES.has(stored as Unit)) {
        setUnit(stored as Unit);
      }
    }
    setUnitHydrated(true);
  }, []);
  const [draft, setDraft] = useState<DraftState | null>(null);
  // Which vendor slot in the cart stack is expanded. Starts with
  // the server-provided value (if any, from the ?expand= param),
  // then overwritten when the user finishes an Add to Cart in this
  // session.
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(
    initialExpandVendorId ?? null
  );

  // Strip ?expand= from the URL once we've consumed it — otherwise
  // a refresh or back-nav would re-trigger the same slot expanding,
  // which is stale after the user has already interacted with the
  // stack. replace() keeps it out of history so Back doesn't send
  // them to the exact same expand state.
  useEffect(() => {
    if (!initialExpandVendorId) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("expand")) {
      url.searchParams.delete("expand");
      router.replace(url.pathname + url.search);
    }
  }, [initialExpandVendorId, router]);
  const { start, phase, progress, error } = useStartPrintFlow();
  const started = useRef(false);
  const uploadGenRef = useRef(0);

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
    setExpandedVendorId(null);
    setPicked({ file, format });
  };

  const handleReset = () => {
    started.current = false;
    uploadGenRef.current++;
    setPicked(null);
    setDraft(null);
  };

  const handleAddedToCart = (vendorId: string) => {
    // Fall back to the idle "print anything" layout with the
    // just-added slot expanded — no separate "what next?" state,
    // it IS the idle state.
    setPicked(null);
    setDraft(null);
    started.current = false;
    setExpandedVendorId(vendorId);
  };

  const uploadWithUnit = useCallback(
    async (pickedFile: PickedFile, nextUnit: Unit) => {
      const gen = ++uploadGenRef.current;
      setDraft({ status: "uploading", file: pickedFile, unit: nextUnit });
      try {
        const model = await uploadFileToCraftCloud(pickedFile.file, nextUnit);
        if (gen !== uploadGenRef.current) return;
        setDraft({
          status: "ready",
          file: pickedFile,
          unit: nextUnit,
          modelId: model.modelId,
          dimensions: model.dimensions,
          volume: model.volume,
        });
      } catch (err) {
        if (gen !== uploadGenRef.current) return;
        setDraft({
          status: "error",
          file: pickedFile,
          unit: nextUnit,
          message:
            err instanceof Error ? err.message : "Failed to upload file.",
        });
      }
    },
    []
  );

  useEffect(() => {
    if (!picked || !isLoaded) return;
    if (!unitHydrated) return;
    if (started.current) return;
    started.current = true;

    if (isSignedIn) {
      start(picked.file, picked.format);
      return;
    }

    uploadWithUnit(picked, unit);
  }, [
    picked,
    isSignedIn,
    isLoaded,
    start,
    uploadWithUnit,
    unit,
    unitHydrated,
  ]);

  const handleUnitChange = (next: Unit) => {
    if (next === unit) return;
    if (!picked) return;
    setUnit(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UNIT_STORAGE_KEY, next);
    }
    uploadWithUnit(picked, next);
  };

  const draftConfig = useMemo(() => {
    if (draft?.status !== "ready") return null;
    return { modelId: draft.modelId, file: draft.file.file };
  }, [draft]);

  const authedActive =
    picked && isSignedIn && (phase === "uploading" || phase === "saving");
  const anonUploading = draft?.status === "uploading";
  const anonReady = draft?.status === "ready";
  const isActive = !!(picked && (authedActive || anonUploading || anonReady));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {!isActive && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{headline}</h1>
          <p className="mt-2 text-muted-foreground">{subheadline}</p>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isActive && picked ? (
            <ActiveColumn
              picked={picked}
              unit={unit}
              isSignedIn={!!isSignedIn}
              draft={draft}
              anonUploading={anonUploading}
              anonReady={anonReady}
              authedActive={!!authedActive}
              draftConfig={draftConfig}
              preselectMaterialId={preselectMaterialId}
              phase={phase}
              progress={progress}
              onUnitChange={handleUnitChange}
              onReset={handleReset}
              onAddedToCart={handleAddedToCart}
            />
          ) : (
            <WhatNextPane
              tiles={tiles}
              linkSuffix={linkSuffix}
              onFilePicked={handleFilePicked}
              uploadError={draft?.status === "error" ? draft.message : error}
            />
          )}
        </div>
        <div className="lg:sticky lg:top-6">
          <CartSlotStack expandedVendorId={expandedVendorId} />
        </div>
      </div>
    </div>
  );
}

function ActiveColumn({
  picked,
  unit,
  isSignedIn,
  draft,
  anonUploading,
  anonReady,
  authedActive,
  draftConfig,
  preselectMaterialId,
  phase,
  progress,
  onUnitChange,
  onReset,
  onAddedToCart,
}: {
  picked: PickedFile;
  unit: Unit;
  isSignedIn: boolean;
  draft: DraftState | null;
  anonUploading: boolean;
  anonReady: boolean;
  authedActive: boolean;
  draftConfig: { modelId: string; file: File } | null;
  preselectMaterialId?: string;
  phase: "idle" | "uploading" | "saving";
  progress: number;
  onUnitChange: (u: Unit) => void;
  onReset: () => void;
  onAddedToCart: (vendorId: string) => void;
}) {
  return (
    <>
      <FileContextBar
        file={picked.file}
        format={picked.format}
        unit={unit}
        dimensions={draft?.status === "ready" ? draft.dimensions : null}
        onUnitChange={onUnitChange}
        unitPickerDisabled={authedActive || anonUploading}
        showUnitPicker={!isSignedIn}
        onReset={onReset}
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

      {anonReady && draftConfig && draft?.status === "ready" && (
        <div className="mt-6">
          <QuoteConfigurator
            draftMode={draftConfig}
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
            preselectMaterialId={preselectMaterialId}
            onAddedToCart={onAddedToCart}
            rightAnnex={({ pendingItem }) => (
              <CartSlotStack pendingItem={pendingItem} />
            )}
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

      {draft?.status === "error" && (
        <p className="mt-4 text-xs text-destructive">{draft.message}</p>
      )}
    </>
  );
}

function FileContextBar({
  file,
  format,
  unit,
  dimensions,
  onUnitChange,
  unitPickerDisabled,
  showUnitPicker,
  onReset,
  statusLabel,
}: {
  file: File;
  format: Format;
  unit: Unit;
  dimensions: { x: number; y: number; z: number } | null;
  onUnitChange: (next: Unit) => void;
  unitPickerDisabled?: boolean;
  showUnitPicker?: boolean;
  onReset: () => void;
  statusLabel?: string | null;
}) {
  const metaLine = (() => {
    if (statusLabel) return statusLabel;
    if (dimensions) {
      return `${dimensions.x.toFixed(1)} × ${dimensions.y.toFixed(1)} × ${dimensions.z.toFixed(1)} mm · ${formatSize(file.size)}`;
    }
    return `${formatSize(file.size)} · .${format}`;
  })();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        .{format}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{metaLine}</p>
      </div>
      {showUnitPicker && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Source units
          </span>
          <Select
            value={unit}
            onValueChange={(v) => onUnitChange(v as Unit)}
            disabled={unitPickerDisabled}
          >
            <SelectTrigger className="h-8 w-[72px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">mm</SelectItem>
              <SelectItem value="cm">cm</SelectItem>
              <SelectItem value="in">in</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
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
