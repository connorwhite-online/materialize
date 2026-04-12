"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MaterialSelector } from "./material-selector";
import { PriceDisplay } from "./price-display";
import { ShippingAddressForm } from "./shipping-address-form";
import { createPrintOrder, completePrintOrder } from "@/app/actions/print";
import { uploadToCraftCloud } from "@/lib/craftcloud/upload-client";
import { checkGeometry } from "@/lib/geometry-checks";
import { getMaterialById } from "@/lib/materials";
import { MaterialPreview } from "@/components/viewer/material-preview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

interface Quote {
  quoteId: string;
  vendorId: string;
  materialConfigId: string;
  printingMethodId: string;
  quantity: number;
  price: number;
  currency: string;
  productionTimeFast: number;
  productionTimeSlow: number;
}

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

  // Checkout state
  const [step, setStep] = useState<CheckoutStep>("configure");
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

  const previewColor = useMemo(() => {
    if (!selectedQuote) return "#a1a1aa";
    return (
      getMaterialById(selectedQuote.materialConfigId)?.color ?? "#a1a1aa"
    );
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
    const { downloadUrl, filename: fname } = await urlRes.json();

    // Upload directly from browser → CraftCloud (no server middleman)
    const model = await uploadToCraftCloud(downloadUrl, fname);

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
        currency: "USD",
        countryCode: "US",
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
    setLoadingPhase("done");
  }, [fileAssetId, quantity]);

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

  const materialGroups = quotes.reduce(
    (acc, quote) => {
      if (!acc[quote.materialConfigId]) {
        acc[quote.materialConfigId] = [];
      }
      acc[quote.materialConfigId].push(quote);
      return acc;
    },
    {} as Record<string, Quote[]>
  );

  // When the user came from a material detail page ("Print with PLA"),
  // auto-pick the cheapest quote in that material group as soon as the
  // quotes land. Skipped if the material has no quotes for this file.
  useEffect(() => {
    if (!preselectMaterialId || selectedQuote || quotes.length === 0) return;
    const group = materialGroups[preselectMaterialId];
    if (!group || group.length === 0) return;
    const cheapest = group.reduce((min, q) => (q.price < min.price ? q : min));
    setSelectedQuote(cheapest);
  }, [preselectMaterialId, quotes, materialGroups, selectedQuote]);

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

  // Loading states
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

  if (loadingPhase === "quoting") {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Getting quotes from manufacturers...
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
      {checkoutError && (
        <Alert variant="destructive" className="mb-4">
          <p className="text-sm">{checkoutError}</p>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {previewModelUrl && previewableFormat && (
            <div className="mb-6 aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
              <MaterialPreview
                modelUrl={previewModelUrl}
                format={format as "stl" | "obj" | "3mf"}
                materialColor={previewColor}
                className="h-full w-full"
              />
            </div>
          )}

          <div className="flex items-center gap-4 mb-4">
            <Label htmlFor="quantity" className="text-sm font-medium">
              Quantity:
            </Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              className="w-20"
            />
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

          <MaterialSelector
            materialGroups={materialGroups}
            selectedQuote={selectedQuote}
            onSelectQuote={setSelectedQuote}
            modelDimensions={geometryData?.dimensions}
          />
        </div>

        <div>
          <PriceDisplay
            selectedQuote={selectedQuote}
            shipping={shipping}
            selectedShipping={selectedShipping}
            onSelectShipping={setSelectedShipping}
            quantity={quantity}
            onCheckout={handleCheckout}
            isCheckingOut={false}
          />
        </div>
      </div>
    </div>
  );
}
