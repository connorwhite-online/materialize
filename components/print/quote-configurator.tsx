"use client";

import { useState, useEffect } from "react";
import { MaterialSelector } from "./material-selector";
import { PriceDisplay } from "./price-display";

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
  geometryData: {
    dimensions?: { x: number; y: number; z: number };
    volume?: number;
    triangleCount?: number;
  } | null;
}

export function QuoteConfigurator({
  fileAssetId,
  filename,
  format,
  geometryData,
}: QuoteConfiguratorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [shipping, setShipping] = useState<ShippingOption[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [selectedShipping, setSelectedShipping] =
    useState<ShippingOption | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    async function fetchQuotes() {
      try {
        setLoading(true);
        const res = await fetch(`/api/craftcloud/quotes`, {
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
          throw new Error("Failed to fetch quotes");
        }

        const data = await res.json();
        setQuotes(data.quotes || []);
        setShipping(data.shipping || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load quotes");
      } finally {
        setLoading(false);
      }
    }

    fetchQuotes();
  }, [fileAssetId, quantity]);

  // Group quotes by material
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
          <p className="mt-3 text-sm text-foreground/60">
            Getting quotes from manufacturers...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="flex items-center gap-4 mb-4">
          <label className="text-sm font-medium">Quantity:</label>
          <input
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="w-20 rounded-md border border-foreground/20 bg-background px-3 py-1.5 text-sm"
          />
        </div>

        {geometryData?.dimensions && (
          <div className="mb-4 text-sm text-foreground/60">
            Dimensions: {geometryData.dimensions.x.toFixed(1)} x{" "}
            {geometryData.dimensions.y.toFixed(1)} x{" "}
            {geometryData.dimensions.z.toFixed(1)} mm
          </div>
        )}

        <MaterialSelector
          materialGroups={materialGroups}
          selectedQuote={selectedQuote}
          onSelectQuote={setSelectedQuote}
        />
      </div>

      <div>
        <PriceDisplay
          selectedQuote={selectedQuote}
          shipping={shipping}
          selectedShipping={selectedShipping}
          onSelectShipping={setSelectedShipping}
          quantity={quantity}
          fileAssetId={fileAssetId}
        />
      </div>
    </div>
  );
}
