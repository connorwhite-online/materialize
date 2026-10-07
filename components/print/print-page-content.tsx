"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useStartPrintFlow } from "@/components/upload/use-start-print-flow";
import { usePendingPrintFile } from "@/components/upload/pending-print-file";
import { uploadFileToR2 } from "@/components/upload/upload-file-to-r2";
import { reportClientError } from "@/lib/observability/report-client-error";
import { QuoteConfigurator } from "@/components/print/quote-configurator";
import type { CheckoutModel } from "@/lib/env";
import { WhatNextPane } from "@/components/print/what-next-pane";
import { ProjectFileChecklist } from "@/components/print/project-file-checklist";
import { CartSlotStack } from "@/components/print/cart-slot-stack";
import { useCart } from "@/components/print/cart-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DottedSpinner } from "@/components/icons/dotted-spinner";
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
  originalFilename?: string;
  fileSizeBytes?: number;
}

interface ProjectMeta {
  name: string;
  thumbnailUrl: string | null;
  author: { username: string | null; displayName: string | null };
  fileCount: number;
  totalFileSizeBytes: number;
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
  /**
   * Heading for the tile list in the idle pane. Defaults to "Your
   * recent files" (personal library); the project print hub passes
   * "Files in this project".
   */
  tilesLabel?: string;
  /**
   * Render the tile list expanded on first paint. The personal
   * library keeps it collapsed (it's a convenience below the
   * uploader); the project hub expands it since the project's files
   * ARE the point of the page.
   */
  tilesDefaultExpanded?: boolean;
  /**
   * When true the left column renders a ProjectFileChecklist (no
   * uploader, always-visible list with cart status) instead of the
   * WhatNextPane. Set for ?project= routes where the project files
   * are the entire scope of the print session.
   */
  isProjectMode?: boolean;
  /**
   * Checkout architecture for new orders — pass
   * `checkoutModel={getCheckoutModel()}` from the server page
   * component (lib/env reads process.env, so the value can't be
   * computed client side). Drilled to QuoteConfigurator →
   * PriceDisplay, which shows the two-charge disclosure under
   * "two_step". Defaults to "single".
   */
  checkoutModel?: CheckoutModel;
  /**
   * Project metadata for the info card rendered above the file
   * checklist in project mode. Includes name, thumbnail, author,
   * file count, and total size.
   */
  projectMeta?: ProjectMeta;
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
  tilesLabel,
  tilesDefaultExpanded,
  isProjectMode,
  checkoutModel = "single",
  projectMeta,
}: PrintPageContentProps) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const cart = useCart();
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
    initialExpandVendorId ?? null,
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
        // Two hops instead of one browser-direct upload: CraftCloud's
        // replacement upload endpoints only accept
        // https://craftcloud3d.com as an origin, so the bytes stage in
        // R2 first and our server relays them. The R2 object is
        // transient — the real upload still happens at checkout under
        // the new owner's key once they sign up.
        const staged = await uploadFileToR2({
          file: pickedFile.file,
          kind: "anon-print",
          anonymous: true,
        });
        if (gen !== uploadGenRef.current) return;
        if ("error" in staged) throw new Error(staged.error);

        const res = await fetch("/api/craftcloud/upload-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey: staged.storageKey,
            fileUnit: nextUnit,
          }),
        });
        if (gen !== uploadGenRef.current) return;
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            step?: string;
          };
          const error = new Error(data.error || "Failed to upload model");
          reportClientError("craftcloud.model-upload-failed", error, {
            status: res.status,
            step: data.step,
            kind: "anon-print",
          });
          throw error;
        }

        const model = (await res.json()) as {
          modelId: string;
          dimensions: { x: number; y: number; z: number } | null;
          volume: number | null;
        };
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
    [],
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
  }, [picked, isSignedIn, isLoaded, start, uploadWithUnit, unit, unitHydrated]);

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

  // The right-hand cart column renders nothing when there are no
  // carts (CartSlotStack returns null for an empty cart). In that
  // idle+empty case we drop the two-column grid and center the title
  // + uploader in the content area, rather than pinning them to the
  // left third with dead space on the right. cart items load via the
  // CartSlotStack refresh below (kept mounted, just visually hidden),
  // so this flips to the two-column layout once carts surface.
  const hasCartContent =
    !!cart && (cart.items.length > 0 || cart.localItems.length > 0);
  const centeredIdle = !isActive && !hasCartContent;

  return (
    <div className="mz-enter mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">
      {!isActive && (
        <header className={centeredIdle ? "mx-auto mb-6 max-w-3xl" : "mb-6"}>
          <h1 className="text-2xl leading-7 font-semibold text-balance">
            {headline}
          </h1>
          <p className="mt-1 text-sm leading-5 text-pretty text-muted-foreground">
            {subheadline}
          </p>
        </header>
      )}

      <div
        className={
          isActive
            ? undefined
            : centeredIdle
              ? "mx-auto max-w-3xl"
              : "grid items-start gap-8 lg:grid-cols-3"
        }
      >
        {/* min-w-0 so the recent-files carousel's overflow-x-auto
            scrolls inside the column instead of blowing out the grid
            track and forcing horizontal page scroll on mobile. */}
        <div
          className={
            isActive || centeredIdle ? "min-w-0" : "min-w-0 lg:col-span-2"
          }
        >
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
              checkoutModel={checkoutModel}
              phase={phase}
              progress={progress}
              onUnitChange={handleUnitChange}
              onReset={handleReset}
              onAddedToCart={handleAddedToCart}
            />
          ) : isProjectMode ? (
            <ProjectFileChecklist
              tiles={tiles}
              linkSuffix={linkSuffix}
              projectMeta={projectMeta}
            />
          ) : (
            <WhatNextPane
              tiles={tiles}
              linkSuffix={linkSuffix}
              onFilePicked={handleFilePicked}
              uploadError={draft?.status === "error" ? draft.message : error}
              tilesLabel={tilesLabel}
              tilesDefaultExpanded={tilesDefaultExpanded}
            />
          )}
        </div>
        {/* Kept mounted even when empty (hidden) so its on-mount cart
            refresh runs and `hasCartContent` can flip to true. While a
            file is being quoted the configurator carries its own copy
            in its right column, so this one steps aside. */}
        <div
          className={
            centeredIdle || isActive ? "hidden" : "min-w-0 lg:sticky lg:top-6"
          }
        >
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
  checkoutModel,
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
  checkoutModel: CheckoutModel;
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
              : "Preparing"
            : anonUploading
              ? "Preparing for manufacturing"
              : null
        }
      />

      {anonReady && draftConfig && draft?.status === "ready" && (
        <div className="mt-8">
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
            checkoutModel={checkoutModel}
            showDimensions={false}
            onAddedToCart={onAddedToCart}
            rightAnnex={({ pendingItem }) => (
              <CartSlotStack pendingItem={pendingItem} />
            )}
          />
        </div>
      )}

      {(authedActive || anonUploading) && (
        <PreparingPlaceholder
          label={
            authedActive && phase === "uploading"
              ? `Uploading · ${progress}%`
              : "Preparing your file for manufacturing"
          }
          progress={authedActive && phase === "uploading" ? progress : null}
        />
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
    // CraftCloud confirm occasionally returns a dimensions object
    // with null components (empty / unparseable meshes). Treat that
    // the same as "no dimensions" rather than crashing the bar.
    if (
      dimensions &&
      typeof dimensions.x === "number" &&
      typeof dimensions.y === "number" &&
      typeof dimensions.z === "number"
    ) {
      return `${dimensions.x.toFixed(1)} × ${dimensions.y.toFixed(1)} × ${dimensions.z.toFixed(1)} mm · ${formatSize(file.size)}`;
    }
    return `${formatSize(file.size)} · .${format}`;
  })();

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-[11px] font-medium text-muted-foreground uppercase"
        >
          {format}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-6 font-semibold">
            {file.name}
          </h1>
          <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {statusLabel && <DottedSpinner size={12} className="shrink-0" />}
            <span className="truncate">{metaLine}</span>
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {showUnitPicker && (
          <Select
            value={unit}
            onValueChange={(v) => onUnitChange(v as Unit)}
            disabled={unitPickerDisabled}
          >
            <SelectTrigger size="sm" aria-label="Model units">
              <SelectValue>
                {(value) => (
                  <span>
                    <span className="text-muted-foreground">Units </span>
                    {value as string}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">Millimeters (mm)</SelectItem>
              <SelectItem value="cm">Centimeters (cm)</SelectItem>
              <SelectItem value="in">Inches (in)</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button variant="secondary" size="sm" onClick={onReset}>
          Change file
        </Button>
      </div>
    </header>
  );
}

/**
 * Stand-in for the configurator while the file is staged and handed
 * to CraftCloud — the same two-column shape the quotes land in, so
 * nothing jumps when they do.
 */
function PreparingPlaceholder({
  label,
  progress,
}: {
  label: string;
  progress: number | null;
}) {
  return (
    <div
      role="status"
      className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]"
    >
      <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-2xl bg-muted px-6 text-center lg:aspect-[3/2]">
        <p className="flex items-center gap-2 text-sm font-medium">
          <DottedSpinner size={14} />
          {label}
        </p>
        {progress !== null ? (
          <div className="h-1 w-40 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-200"
              style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
            />
          </div>
        ) : (
          <p className="text-[13px] leading-[18px] text-muted-foreground">
            Quotes start arriving in a few seconds.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-full rounded-[10px]" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-10 rounded-[10px]" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
