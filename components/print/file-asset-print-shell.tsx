"use client";

import { useRouter } from "next/navigation";
import { type ReactNode } from "react";
import { QuoteConfigurator } from "@/components/print/quote-configurator";
import { CartSlotStack } from "@/components/print/cart-slot-stack";
import type { CheckoutModel } from "@/lib/env";

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
  /** CraftCloud finish group id. When set alongside preselectMaterialId, the picker jumps to vendor. */
  preselectFinishGroupId?: string;
  /**
   * Page-level header (h1 + filename meta + creator recommendation).
   * Always rendered here since a successful Add to Cart routes the
   * user away to /print — no need for a header-hiding pivot.
   */
  configureHeader?: ReactNode;
  /**
   * Slug of the project print hub the user arrived from ("Print this
   * project"). When set, a successful Add to Cart routes back into
   * that hub (`/print?project=<slug>&expand=…`) instead of the
   * personal library, so the user keeps walking the project's files.
   */
  projectSlug?: string;
  /**
   * Checkout architecture for new orders — pass
   * `checkoutModel={getCheckoutModel()}` from the server page
   * component. Forwarded to QuoteConfigurator → PriceDisplay for the
   * two-charge disclosure under "two_step". Defaults to "single".
   */
  checkoutModel?: CheckoutModel;
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
  preselectFinishGroupId,
  configureHeader,
  projectSlug,
  checkoutModel = "single",
}: FileAssetPrintShellProps) {
  const router = useRouter();

  const handleAddedToCart = (vendorId: string) => {
    const expand = `expand=${encodeURIComponent(vendorId)}`;
    // Stay inside the project print hub when the user came from
    // "Print this project" — otherwise they'd lose the project's
    // file list after the first add and drop into the personal library.
    const dest = projectSlug
      ? `/print?project=${encodeURIComponent(projectSlug)}&${expand}`
      : `/print?${expand}`;
    router.push(dest);
  };

  return (
    // Header is forwarded into QuoteConfigurator as `headerSlot` so
    // that on lg+ it sits beside the 3D viewer rather than stretching
    // across the full width above. QuoteConfigurator handles the
    // mobile fallback (header on top, viewer below) internally.
    <QuoteConfigurator
      fileAssetId={fileAssetId}
      filename={filename}
      format={format}
      hasCachedModel={hasCachedModel}
      geometryData={geometryData}
      preselectMaterialId={preselectMaterialId}
      preselectFinishGroupId={preselectFinishGroupId}
      checkoutModel={checkoutModel}
      onAddedToCart={handleAddedToCart}
      headerSlot={configureHeader}
      rightAnnex={({ pendingItem }) => (
        // Mobile already has cart access via the top-right
        // CartButton, which opens the full CartPanel drawer.
        // Stacking this inline cart below all vendors on a
        // phone is just noise the user has to scroll past — it
        // reads as a desktop side-rail and that's where it stays.
        <div className="hidden lg:block">
          <CartSlotStack pendingItem={pendingItem} />
        </div>
      )}
    />
  );
}
