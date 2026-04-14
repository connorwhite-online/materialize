"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MaterialPicker } from "./material-picker";
import type { EnrichedQuote } from "./material-picker/types";
import { PriceDisplay } from "./price-display";
import { ShippingAddressForm } from "./shipping-address-form";
import { createPrintOrder, completePrintOrder } from "@/app/actions/print";
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

interface QuoteConfiguratorProps {
  fileAssetId: string;
  filename: string;
  format: string;
  hasCachedModel: boolean;
  geometryData: {
    dimensions?: { x: number; y: number; z: number };
    volume?: number;
    triangleCount?: number;
  } | null;
  preselectMaterialId?: string;
}

type CheckoutStep = "configure" | "address" | "processing";
type LoadingPhase = "uploading" | "quoting" | "done";

export function QuoteConfigurator({
  fileAssetId,
  filename,
  format,
  hasCachedModel,
  geometryData,
  preselectMaterialId,
}: QuoteConfiguratorProps) {
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase | null>(
    "uploading"
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
  }, [fileAssetId]);

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
  }, [fileAssetId, hasCachedModel]);

  const fetchQuotes = useCallback(async () => {
    setLoadingPhase("quoting");
    setError(null);

    const res = await fetch("/api/craftcloud/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileAssetId,
        currency: region.currency,
        countryCode: region.code,
        quantity,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch quotes");
    }

    const data = await res.json();
    setQuotes(data.quotes || []);
    setShipping(data.shipping || []);
    // Region switch: clear the selection because a quoteId from the
    // previous region is no longer valid against the new quote set.
    setSelectedQuote(null);
    setSelectedShipping(null);
    setLoadingPhase("done");
  }, [fileAssetId, quantity, region.currency, region.code]);

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
    };
  }, [ensureModelUploaded, fetchQuotes]);


  const handleCheckout = async () => {
    if (!selectedQuote || !selectedShipping) return;
    setCheckoutError(null);

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
    if (!printOrderId) return;
    setStep("processing");
    setCheckoutError(null);

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
            preselectMaterialId={preselectMaterialId}
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
