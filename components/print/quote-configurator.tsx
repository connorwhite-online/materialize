"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { PendingItem } from "./cart-slot-stack";
import { MaterialPicker } from "./material-picker";
import type { EnrichedQuote } from "./material-picker/types";
import { PriceDisplay, type MinimumFeeInfo } from "./price-display";
import type { Currency } from "@/lib/craftcloud/types";
import { ShippingAddressForm } from "./shipping-address-form";
import { pollQuotes } from "./poll-quotes";
import { runAnonCheckout } from "./run-anon-checkout";
import {
  createPrintOrder,
  completePrintOrder,
  checkCartPricing,
} from "@/app/actions/print";
import { useCart } from "./cart-context";
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
   * CraftCloud material id from /materials/[slug] → "Print with X".
   * Passed straight through to MaterialPicker, which exact-matches
   * it against the returned quotes to auto-advance past the
   * material step.
   */
  preselectMaterialId?: string;
  /**
   * Fired after a successful Add to Cart. The parent uses this to
   * pivot /print into the "what next?" state and expand the
   * matching vendor slot in the cart stack.
   */
  onAddedToCart?: (vendorId: string) => void;
  /**
   * Extra content rendered below PriceDisplay in the sticky right
   * column — used to slot the CartSlotStack beneath the active
   * session's order summary on /print. Receives the live
   * pendingItem so the stack can preview a merge into a matching
   * existing vendor cart.
   */
  rightAnnex?: (ctx: { pendingItem: PendingItem | null }) => ReactNode;
}

type CheckoutStep = "configure" | "address" | "processing";
type LoadingPhase = "uploading" | "quoting" | "done" | "timeout";

export function QuoteConfigurator({
  fileAssetId,
  draftMode,
  filename,
  format,
  hasCachedModel,
  geometryData,
  preselectMaterialId,
  onAddedToCart,
  rightAnnex,
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

  // Guards handleAddressSubmit against double-fire. Without this,
  // a double-click (or rapid re-tap on mobile) would run the full
  // presign → R2 PUT → createDraftFileForPrint → createPrintOrder
  // → Stripe checkout chain twice in parallel, resulting in two
  // orders and two charges. Set at the top of the chain and
  // cleared on error so the user can retry.
  const checkoutInFlightRef = useRef(false);

  const cart = useCart();
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  // Vendor minimum production fee — probed via a lightweight cart
  // creation after the user picks a quote + shipping. The fee is
  // only available from CraftCloud's /v5/cart response, not in the
  // quote-level data, so we check as soon as both are selected.
  const [minimumFeeInfo, setMinimumFeeInfo] = useState<MinimumFeeInfo | null>(
    null
  );
  const [checkingMinimum, setCheckingMinimum] = useState(false);

  useEffect(() => {
    if (!selectedQuote || !selectedShipping) {
      setMinimumFeeInfo(null);
      setCheckingMinimum(false);
      return;
    }

    // Clear stale data from the previous vendor/quote while we check.
    setMinimumFeeInfo(null);
    setCheckingMinimum(true);

    let cancelled = false;

    // Debounce — rapid shipping-option toggles would otherwise fire
    // a disposable CraftCloud cart-create per keystroke. 300ms is
    // short enough that a committed choice reflects quickly, long
    // enough that cycling through radio options while deliberating
    // only pays for the final pick.
    const handle = setTimeout(() => {
      checkCartPricing({
        quoteId: selectedQuote.quoteId,
        vendorId: selectedQuote.vendorId,
        shippingId: selectedShipping.shippingId,
        currency: selectedQuote.currency as Currency,
      }).then((result) => {
        if (cancelled) return;
        setCheckingMinimum(false);
        if ("error" in result) return;
        setMinimumFeeInfo(result);
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [selectedQuote, selectedShipping, quantity]);

  const handleAddToCart = useCallback(async () => {
    if (!selectedQuote || !selectedShipping || !cart) return;
    setIsAddingToCart(true);
    setCheckoutError(null);
    try {
      if (draftMode) {
        const localResult = cart.addLocalItem({
          file: draftMode.file,
          modelId: draftMode.modelId,
          originalFilename: filename,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          shippingId: selectedShipping.shippingId,
          quantity,
          materialPrice: selectedQuote.price,
          shippingPrice: selectedShipping.price,
          currency: selectedQuote.currency,
          countryCode: region.code,
        });
        if ("error" in localResult) {
          setCheckoutError(localResult.error);
        } else {
          onAddedToCart?.(selectedQuote.vendorId);
        }
      } else if (fileAssetId) {
        const result = await cart.addItem({
          fileAssetId,
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          shippingId: selectedShipping.shippingId,
          quantity,
          materialPrice: selectedQuote.price,
          shippingPrice: selectedShipping.price,
          currency: selectedQuote.currency,
          countryCode: region.code,
        });
        if ("error" in result) {
          setCheckoutError(result.error);
        } else {
          onAddedToCart?.(selectedQuote.vendorId);
        }
      }
    } finally {
      setIsAddingToCart(false);
    }
  }, [selectedQuote, selectedShipping, fileAssetId, draftMode, cart, quantity, region.code, filename, onAddedToCart]);

  // Active material scope for the CraftCloud price request. Starts
  // as the preselectMaterialId (from /materials/[slug] → Print with
  // X); a callback from MaterialPicker clears it when the user
  // navigates back to the full material grid, which then refetches
  // the unscoped quote set.
  const [scopedMaterialId, setScopedMaterialId] = useState<string | null>(
    preselectMaterialId ?? null
  );
  useEffect(() => {
    // If the parent passes a new preselect on a subsequent render
    // (rare — really only from a Link prefetch rehydration) adopt
    // it as the new scope.
    if (preselectMaterialId && preselectMaterialId !== scopedMaterialId) {
      setScopedMaterialId(preselectMaterialId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectMaterialId]);

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
          ...(scopedMaterialId ? { materialId: scopedMaterialId } : {}),
        }),
        signal,
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to start quote request");
      }
      const { priceId } = (await startRes.json()) as { priceId: string };

      // 2. Hand off to the shared poll loop. See
      // components/print/poll-quotes.ts for the termination
      // invariant (allComplete + stable count). Each snapshot
      // drops straight into React state.
      const reason = await pollQuotes({
        priceId,
        signal,
        onSnapshot: (snapshot) => {
          setQuotes(snapshot.quotes ?? []);
          setShipping(snapshot.shipping ?? []);
        },
      });

      if (!signal.aborted) {
        // "timeout" means we hit the hard ceiling before CraftCloud
        // marked the quote set stable — late vendors might still
        // arrive if the user retries. The picker uses this phase to
        // show a "showing partial results" hint with a Retry action
        // instead of the silent "Done" state.
        setLoadingPhase(reason === "timeout" ? "timeout" : "done");
      }
    } catch (err) {
      if (signal.aborted || (err as { name?: string }).name === "AbortError") {
        return;
      }
      throw err;
    }
  }, [
    fileAssetId,
    draftMode,
    quantity,
    region.currency,
    region.code,
    scopedMaterialId,
  ]);

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
      vendorName: selectedQuote.vendorName,
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
    // Bail immediately if a previous handleAddressSubmit is still
    // in flight (double-click, mobile tap repeat). Without this
    // guard, the anon chain below would fire the entire R2 →
    // draft → order → Stripe pipeline twice in parallel.
    if (checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;

    setStep("processing");
    setCheckoutError(null);

    // Draft path — ShippingAddressForm just finished the Clerk OTP
    // sign-up so the session is hot. Run the shared checkout
    // chain and redirect to Stripe on success.
    if (draftMode) {
      if (!selectedQuote || !selectedShipping) {
        setCheckoutError("Please pick a material and a shipping option.");
        setStep("address");
        checkoutInFlightRef.current = false;
        return;
      }

      const result = await runAnonCheckout({
        file: draftMode.file,
        selectedQuote: {
          quoteId: selectedQuote.quoteId,
          vendorId: selectedQuote.vendorId,
          vendorName: selectedQuote.vendorName,
          materialConfigId: selectedQuote.materialConfigId,
          price: selectedQuote.price,
          currency: selectedQuote.currency,
        },
        selectedShipping: {
          shippingId: selectedShipping.shippingId,
          price: selectedShipping.price,
        },
        quantity,
        addressData,
      });

      if (!result.ok) {
        setCheckoutError(result.error);
        setStep("address");
        checkoutInFlightRef.current = false;
        return;
      }

      window.location.href = result.checkoutUrl;
      return;
    }

    if (!printOrderId) {
      checkoutInFlightRef.current = false;
      return;
    }

    const result = await completePrintOrder({
      orderId: printOrderId,
      email: addressData.email,
      shipping: addressData.shipping,
      billing: addressData.billing,
    });

    if ("error" in result) {
      setCheckoutError(result.error);
      setStep("address");
      checkoutInFlightRef.current = false;
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
      <Alert variant="destructive" className="flex flex-col items-start gap-3">
        <div>
          <p className="text-sm font-medium">We couldn&apos;t load quotes for this file</p>
          <p className="mt-1 text-xs opacity-90">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setLoadingPhase(isDraft ? "quoting" : "uploading");
            fetchQuotes().catch((err) => {
              setError(err instanceof Error ? err.message : "Something went wrong");
              setLoadingPhase("done");
            });
          }}
          className="rounded-md border border-current/30 bg-background/60 px-3 py-1 text-xs font-medium hover:bg-background/90"
        >
          Retry
        </button>
      </Alert>
    );
  }

  // Shape the current selection as a PendingItem so the cart-slot
  // stack on the right can preview a merge into a matching vendor
  // cart. Only populated once a quote is picked — before that,
  // there's no vendor to merge into.
  const pendingItem: PendingItem | null = selectedQuote
    ? {
        vendorId: selectedQuote.vendorId,
        filename,
        quantity,
        materialPrice: Math.round(selectedQuote.price * 100),
      }
    : null;

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
          {geometryData?.dimensions &&
            typeof geometryData.dimensions.x === "number" &&
            typeof geometryData.dimensions.y === "number" &&
            typeof geometryData.dimensions.z === "number" && (
              <div className="mb-3 text-sm text-muted-foreground">
                Dimensions: {geometryData.dimensions.x.toFixed(1)} ×{" "}
                {geometryData.dimensions.y.toFixed(1)} ×{" "}
                {geometryData.dimensions.z.toFixed(1)} mm
              </div>
            )}

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

          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="quantity"
                className="text-sm font-medium leading-none"
              >
                Quantity
              </Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) => {
                  // Clamp to [1, 100] and reject NaN — empty/invalid
                  // text falls back to 1 so the quote pipeline never
                  // sees a non-finite number.
                  const raw = Number(e.target.value);
                  const next = Number.isFinite(raw)
                    ? Math.min(100, Math.max(1, Math.trunc(raw)))
                    : 1;
                  setQuantity(next);
                }}
                className="w-20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="region"
                className="text-sm font-medium leading-none"
              >
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
            quotesPartial={loadingPhase === "timeout"}
            onRetryQuotes={() => {
              setLoadingPhase(isDraft ? "quoting" : "uploading");
              fetchQuotes().catch((err) => {
                setError(err instanceof Error ? err.message : "Something went wrong");
                setLoadingPhase("done");
              });
            }}
            selectedQuote={selectedQuote}
            onSelectQuote={setSelectedQuote}
            preselectMaterialId={preselectMaterialId}
            onClearPreselectScope={() => setScopedMaterialId(null)}
          />
        </div>

        <div className="lg:sticky lg:top-6 space-y-4">
          <PriceDisplay
            selectedQuote={selectedQuote}
            shipping={shipping}
            selectedShipping={selectedShipping}
            onSelectShipping={setSelectedShipping}
            quantity={quantity}
            onCheckout={handleCheckout}
            isCheckingOut={false}
            checkoutError={checkoutError}
            onAddToCart={(fileAssetId || draftMode) && cart ? handleAddToCart : undefined}
            isAddingToCart={isAddingToCart}
            minimumFeeInfo={minimumFeeInfo}
            checkingMinimum={checkingMinimum}
          />
          {rightAnnex?.({ pendingItem })}
        </div>
      </div>
    </div>
  );
}
