"use client";

import { useRouter } from "next/navigation";
import { type ReactNode } from "react";
import { QuoteConfigurator } from "@/components/print/quote-configurator";
import { CartSlotStack } from "@/components/print/cart-slot-stack";

interface FileAssetPrintShellProps {
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
  /**
   * Page-level header (h1 + filename meta + creator recommendation).
   * Always rendered here since a successful Add to Cart routes the
   * user away to /print — no need for a header-hiding pivot.
   */
  configureHeader?: ReactNode;
}

/**
 * Client wrapper around QuoteConfigurator for the authed
 * /print/[fileAssetId] page. Adds the shared CartSlotStack beside
 * the configurator and, on a successful Add to Cart, routes back
 * to /print with the just-added vendor pre-expanded so the user
 * lands on the unified "print anything" screen instead of a
 * one-off "what next?" pane.
 */
export function FileAssetPrintShell({
  fileAssetId,
  filename,
  format,
  hasCachedModel,
  geometryData,
  preselectMaterialId,
  configureHeader,
}: FileAssetPrintShellProps) {
  const router = useRouter();

  const handleAddedToCart = (vendorId: string) => {
    router.push(`/print?expand=${encodeURIComponent(vendorId)}`);
  };

  return (
    <div>
      {configureHeader}
      <div className={configureHeader ? "mt-6" : undefined}>
        <QuoteConfigurator
          fileAssetId={fileAssetId}
          filename={filename}
          format={format}
          hasCachedModel={hasCachedModel}
          geometryData={geometryData}
          preselectMaterialId={preselectMaterialId}
          onAddedToCart={handleAddedToCart}
          rightAnnex={({ pendingItem }) => (
            <CartSlotStack pendingItem={pendingItem} />
          )}
        />
      </div>
    </div>
  );
}
