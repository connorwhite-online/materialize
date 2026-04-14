"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MaterialPicker } from "./material-picker";
import type { EnrichedQuote } from "./material-picker/types";
import { PriceDisplay } from "./price-display";
import { ShippingAddressForm } from "./shipping-address-form";
import { createPrintOrder, completePrintOrder } from "@/app/actions/print";
import { createDraftFileForPrint } from "@/app/actions/files";
import { uploadToCraftCloud } from "@/lib/craftcloud/upload-client";
import { checkGeometry } from "@/lib/geometry-checks";
import { REGIONS, DEFAULT_REGION } from "@/lib/craftcloud/regions";
import { MaterialPreview } from "@/components/viewer/material-preview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Quote = EnrichedQuote;

/** Sleep helper that rejects with an AbortError when the signal fires. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

export interface DraftModeConfig {
  /** CraftCloud model id — the client already uploaded the file. */
  modelId: string;
  /** Local File for the preview (object URL + future R2 upload). */
  file: File;
}

interface QuoteConfiguratorProps {
  /** Authed path — points at a row in our DB. */
  fileAssetId?: string;
  /**
   * Anon draft path — the file only exists client-side + on
   * CraftCloud. Mutually exclusive with fileAssetId.
   */
  draftMode?: DraftModeConfig;
  filename: string;
  format: string;
  hasCachedModel: boolean;
  geometryData: {
    dimensions?: { x: number; y: number; z: number };
    volume?: number;
    triangleCount?: number;
  } | null;
  /**
   * Material-name hint from /materials/[slug] → "Print with X".
   * Passed straight through to MaterialPicker, which fuzzy-matches
   * it against quotes to auto-advance the user past the material
   * step. See MaterialPicker.findMaterialByNameHint.
   */
  preselectMaterialName?: string;
}

type CheckoutStep = "configure" | "address" | "processing";
type LoadingPhase = "uploading" | "quoting" | "done";

export function QuoteConfigurator({
  fileAssetId,
  draftMode,
  filename,
  format,
  hasCachedModel,
  geometryData,
  preselectMaterialName,
}: QuoteConfiguratorProps) {
  const isDraft = !!draftMode;

  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase | null>(
    // In draft mode the model is already on CraftCloud — skip straight
    // to quoting instead of sitting on the upload spinner.
    isDraft ? "quoting" : "uploading"
  );
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [shipping, setShipping] = useState<ShippingOption[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedShipping, setSelectedShipping] =
    useState<ShippingOption | null>(null);
  const [quantity, setQuantity] = useState(1);

  // Region drives which country + currency we ask CraftCloud for
  // quotes in. Persisted to localStorage so the user's pick survives
  // page reloads. Default is the first region in REGIONS (US / USD).
  const [regionCode, setRegionCode] = useState<string>(DEFAULT_REGION.code);
  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("print-region")
        : null;
    if (stored && REGIONS.some((r) => r.code === stored)) {
      setRegionCode(stored);
    }
  }, []);
  const region =
    REGIONS.find((r) => r.code === regionCode) ?? DEFAULT_REGION;

  // Checkout state
  const [step, setStep] = useState<CheckoutStep>("configure");
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // The checkout error should only reflect the most recent attempt.
  // Any change to the quote, shipping, quantity, or region makes the
  // previous failure stale — clear it so the user doesn't see a red
  // banner for a configuration they've already moved past.
  useEffect(() => {
    setCheckoutError(null);
  }, [selectedQuote, selectedShipping, quantity, regionCode]);

  // Resolved download URL for the model preview viewer.
  const [previewModelUrl, setPreviewModelUrl] = useState<string | null>(null);

  useEffect(() => {
    // Draft mode: blob URL from the in-memory File.
    if (draftMode) {
      const url = URL.createObjectURL(draftMode.file);
      setPreviewModelUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    if (!fileAssetId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/craftcloud/download-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileAssetId }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPreviewModelUrl(data.downloadUrl);
      } catch {
        // Preview is non-critical — fall back to silent skip.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileAssetId, draftMode]);

  // The 3D preview tints the model with the selected quote's real
  // colorCode from CraftCloud's catalog. Falls back to a neutral
  // grey before anything is picked.
  const previewColor = useMemo(() => {
    if (!selectedQuote) return "#a1a1aa";
    return selectedQuote.colorCode || "#a1a1aa";
  }, [selectedQuote]);

  const previewableFormat =
    format === "stl" || format === "obj" || format === "3mf";

  const ensureModelUploaded = useCallback(async () => {
    // Draft mode — the model was already uploaded client-side and we
    // have a modelId in hand. Nothing to do.
    if (draftMode) return;
    if (!fileAssetId) return;
    if (hasCachedModel) return;

    setLoadingPhase("uploading");

    // Get download URL from our server
    const urlRes = await fetch("/api/craftcloud/download-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileAssetId }),
    });

    if (!urlRes.ok) throw new Error("Failed to get download URL");
    const {
      downloadUrl,
      filename: fname,
      fileUnit,
    } = (await urlRes.json()) as {
      downloadUrl: string;
      filename: string;
      fileUnit?: "mm" | "cm" | "in";
    };

    // Upload directly from browser → CraftCloud (no server middleman).
    // The unit tells CraftCloud how to interpret the model's native
    // coordinates — defaulting to mm for old rows that predate the
    // file_assets.file_unit column.
    const model = await uploadToCraftCloud(downloadUrl, fname, fileUnit ?? "mm");

    // Cache the modelId on our server
    await fetch("/api/craftcloud/cache-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileAssetId,
        modelId: model.modelId,
        geometry: model.dimensions
          ? {
              dimensions: model.dimensions,
              volume: model.volume,
            }
          : undefined,
      }),
    });
  }, [fileAssetId, hasCachedModel, draftMode]);

  // Each fetchQuotes invocation owns an AbortController stored in
  // this ref. A new invocation aborts the previous one so a stale
  // region/quantity change can't clobber the user's current view
  // with half-finished polling from the old request.
  const pollAbortRef = useRef<AbortController | null>(null);

  const fetchQuotes = useCallback(async () => {
    // Cancel any in-flight polling loop from a previous invocation.
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    const { signal } = controller;

    setLoadingPhase("quoting");
    setError(null);
    // Region/quantity switch: clear selection since the existing
    // quoteId is no longer valid against the new quote set.
    setSelectedQuote(null);
    setSelectedShipping(null);
    // Don't wipe the existing cards — they'll repopulate as new
    // poll snapshots come in, and keeping them avoids a flash of
    // empty state during a region change.

    try {
      // 1. Start the price request and get a priceId back.
      const startRes = await fetch("/api/craftcloud/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draftMode ? { modelId: draftMode.modelId } : { fileAssetId }),
          currency: region.currency,
          countryCode: region.code,
          quantity,
        }),
        signal,
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start quote request");
      }
      const { priceId } = (await startRes.json()) as { priceId: string };

      // 2. Poll snapshot endpoint until CraftCloud says it's done
      // or we hit the ceiling. Each snapshot replaces the quotes
      // state — the endpoint returns the full growing set, so no
      // client-side merging is needed.
      const POLL_INTERVAL_MS = 1500;
      const HARD_CEILING_MS = 90_000;
      const started = Date.now();
      let allComplete = false;
      let hadFirstPaint = false;

      while (!signal.aborted && !allComplete) {
        const elapsed = Date.now() - started;
        if (elapsed > HARD_CEILING_MS) break;

        const pollRes = await fetch(
          `/api/craftcloud/quotes/poll?priceId=${encodeURIComponent(priceId)}`,
          { signal }
        );
        if (signal.aborted) return;
        if (!pollRes.ok) {
          // Transient poll errors shouldn't kill the loop — retry
          // after the interval unless the whole thing's aborted.
          await wait(POLL_INTERVAL_MS, signal);
          continue;
        }
        const snapshot = (await pollRes.json()) as {
          quotes: Quote[];
          shipping: ShippingOption[];
          allComplete: boolean;
        };

        setQuotes(snapshot.quotes ?? []);
        setShipping(snapshot.shipping ?? []);
        allComplete = snapshot.allComplete;

        // Flip loadingPhase to "done" as soon as we have a usable
        // snapshot. From there the user can interact with the
        // priced cards even while more vendors trickle in — unpriced
        // cards still pulse as skeletons because `quotesLoading`
        // stays tied to `hadFirstPaint` + `allComplete`.
        if (!hadFirstPaint && (snapshot.quotes?.length ?? 0) > 0) {
          hadFirstPaint = true;
        }

        if (allComplete) break;
        await wait(POLL_INTERVAL_MS, signal);
      }

      if (!signal.aborted) {
        setLoadingPhase("done");
      }
    } catch (err) {
      if (signal.aborted || (err as { name?: string }).name === "AbortError") {
        return;
      }
      throw err;
    }
  }, [fileAssetId, draftMode, quantity, region.currency, region.code]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await ensureModelUploaded();
        if (cancelled) return;
        await fetchQuotes();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setLoadingPhase("done");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      pollAbortRef.current?.abort();
    };
  }, [ensureModelUploaded, fetchQuotes]);


  const handleCheckout = async () => {
    if (!selectedQuote || !selectedShipping) return;
    setCheckoutError(null);

    // Draft / anon path — defer the actual order creation until
    // after the address form finishes the Clerk OTP sign-up flow.
    // We just need to advance the UI to the address step here; the
    // heavy chain (R2 → draft file → print order → stripe) runs
    // inside handleAddressSubmit once we know the user is authed.
    if (draftMode || !fileAssetId) {
      setStep("address");
      return;
    }

    const result = await createPrintOrder({
      fileAssetId,
      quoteId: selectedQuote.quoteId,
      vendorId: selectedQuote.vendorId,
      materialConfigId: selectedQuote.materialConfigId,
      shippingId: selectedShipping.shippingId,
      quantity,
      materialPrice: selectedQuote.price,
      shippingPrice: selectedShipping.price,
      currency: selectedQuote.currency as "USD",
    });

    if ("error" in result) {
      setCheckoutError(result.error);
      return;
    }

    setPrintOrderId(result.orderId);
    setStep("address");
  };

  const handleAddressSubmit = async (addressData: {
    email: string;
    shipping: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
    };
    billing: {
      firstName: string;
      lastName: string;
      address: string;
      addressLine2?: string;
      city: string;
      zipCode: string;
      stateCode?: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
      isCompany: boolean;
      vatId?: string;
    };
  }) => {
    setStep("processing");
    setCheckoutError(null);

    // Draft path — ShippingAddressForm just finished the Clerk OTP
    // sign-up so the session is hot. Chain the whole pipeline that
    // authed users normally walk in multiple trips:
    //   R2 presign → PUT → createDraftFileForPrint
    //   → createPrintOrder → completePrintOrder → Stripe
    if (draftMode) {
      if (!selectedQuote || !selectedShipping) {
        setCheckoutError("Please pick a material and a shipping option.");
        setStep("address");
        return;
      }
      try {
        const presignRes = await fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: draftMode.file.name,
            contentType: "application/octet-stream",
            fileSize: draftMode.file.size,
          }),
        });
        if (!presignRes.ok) {
          const data = await presignRes.json().catch(() => ({}));
          throw new Error(
            data.error || `Upload presign failed (${presignRes.status})`
          );
        }
        const {
          uploadUrl,
          storageKey,
          format: resolvedFormat,
        } = (await presignRes.json()) as {
          uploadUrl: string;
          storageKey: string;
          format: "stl" | "obj" | "3mf" | "step" | "amf";
        };

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: draftMode.file,
        });
        if (!putRes.ok) {
          throw new Error(`R2 upload failed (${putRes.status})`);
        }

        const draft = await createDraftFileForPrint({
          storageKey,
          originalFilename: draftMode.file.name,
          format: resolvedFormat,
          fileSize: draftMode.file.size,
        });
        if ("error" in draft) throw new Error(draft.error);

        const orderResult = await createPrintOrder({
          fileAssetId: draft.fileAssetId,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          materialConfigId: selectedQuote.materialConfigId,
          shippingId: selectedShipping.shippingId,
          quantity,
          materialPrice: selectedQuote.price,
          shippingPrice: selectedShipping.price,
          currency: selectedQuote.currency as "USD",
        });
        if ("error" in orderResult) throw new Error(orderResult.error);

        const completeResult = await completePrintOrder({
          orderId: orderResult.orderId,
          email: addressData.email,
          shipping: addressData.shipping,
          billing: addressData.billing,
          isAnonFlow: true,
        });
        if ("error" in completeResult) throw new Error(completeResult.error);

        window.location.href = completeResult.checkoutUrl;
        return;
      } catch (err) {
        setCheckoutError(
          err instanceof Error ? err.message : "Checkout failed"
        );
        setStep("address");
        return;
      }
    }

    if (!printOrderId) return;

    const result = await completePrintOrder({
      orderId: printOrderId,
      email: addressData.email,
      shipping: addressData.shipping,
      billing: addressData.billing,
    });

    if ("error" in result) {
      setCheckoutError(result.error);
      setStep("address");
      return;
    }

    window.location.href = result.checkoutUrl;
  };

  // Only the initial upload-to-CraftCloud step still gates the UI —
  // we need a craftCloudModelId before we can ask for a quote at all.
  // Once that's done, the picker renders immediately with catalog
  // data and the quote polling happens in the background.
  if (loadingPhase === "uploading") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Preparing your file for manufacturing...
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            This may take a moment for large files
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <p className="text-sm">{error}</p>
      </Alert>
    );
  }

  if (step === "address" || step === "processing") {
    return (
      <div className="max-w-lg mx-auto">
        {checkoutError && (
          <Alert variant="destructive" className="mb-4">
            <p className="text-sm">{checkoutError}</p>
          </Alert>
        )}
        <ShippingAddressForm
          onSubmit={handleAddressSubmit}
          onBack={() => setStep("configure")}
          isSubmitting={step === "processing"}
          anonMode={isDraft}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="grid items-start gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {previewModelUrl && previewableFormat && (
            <div className="mb-6 aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
              <MaterialPreview
                modelUrl={previewModelUrl}
                format={format as "stl" | "obj" | "3mf"}
                materialColor={previewColor}
                className="h-full w-full"
                enableWheelZoom={false}
                showZoomControls
              />
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="quantity" className="text-sm font-medium">
                Quantity
              </Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value)))
                }
                className="w-20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="region" className="text-sm font-medium">
                Ship to
              </Label>
              <Select
                value={regionCode}
                onValueChange={(value) => {
                  if (!value) return;
                  setRegionCode(value);
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("print-region", value);
                  }
                }}
              >
                <SelectTrigger id="region" className="min-w-44">
                  <SelectValue>
                    {(value) => {
                      const r = REGIONS.find((r) => r.code === value);
                      if (!r) return DEFAULT_REGION.name;
                      return `${r.name} (${r.currency})`;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name} ({r.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {geometryData?.dimensions &&
            typeof geometryData.dimensions.x === "number" &&
            typeof geometryData.dimensions.y === "number" &&
            typeof geometryData.dimensions.z === "number" && (
              <div className="mb-4 text-sm text-muted-foreground">
                Dimensions: {geometryData.dimensions.x.toFixed(1)} x{" "}
                {geometryData.dimensions.y.toFixed(1)} x{" "}
                {geometryData.dimensions.z.toFixed(1)} mm
              </div>
            )}

          {/* Geometry hints — soft warnings, never blocking */}
          {(() => {
            const hints = checkGeometry(geometryData);
            if (hints.length === 0) return null;
            return (
              <div className="mb-4 space-y-2">
                {hints.map((hint, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950"
                  >
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                      {hint.message}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      {hint.detail}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="my-6 border-t border-border" />

          <MaterialPicker
            quotes={quotes}
            shipping={shipping}
            quotesLoading={loadingPhase === "quoting"}
            selectedQuote={selectedQuote}
            onSelectQuote={setSelectedQuote}
            preselectMaterialName={preselectMaterialName}
          />
        </div>

        <div className="lg:sticky lg:top-6">
          <PriceDisplay
            selectedQuote={selectedQuote}
            shipping={shipping}
            selectedShipping={selectedShipping}
            onSelectShipping={setSelectedShipping}
            quantity={quantity}
            onCheckout={handleCheckout}
            isCheckingOut={false}
            checkoutError={checkoutError}
          />
        </div>
      </div>
    </div>
  );
}
