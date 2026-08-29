"use client";

import type { CheckoutModel } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { calcServiceFee } from "@/lib/fees";
import { SandboxBadge } from "@/components/sandbox-badge";
import { useSandbox } from "@/components/sandbox-context";
import type { ShippingOption } from "./shipping-options";

interface Quote {
  quoteId: string;
  vendorId: string;
  materialConfigId: string;
  price: number;
  currency: string;
}

export interface MinimumFeeInfo {
  /** Dollars — extra fee added to reach the vendor's minimum (0 if none). */
  minimumProductionFee: number;
  /** Dollars — the vendor's minimum production price (0 if none). */
  vendorMinimumPrice: number;
}

interface PriceDisplayProps {
  selectedQuote: Quote | null;
  selectedShipping: ShippingOption | null;
  quantity: number;
  checkoutError?: string | null;
  /** Vendor minimum production fee info from checkCartPricing. */
  minimumFeeInfo?: MinimumFeeInfo | null;
  /** True while checkCartPricing is in flight. */
  checkingMinimum?: boolean;
  /**
   * When the configured vendor already has a cart, shipping is fixed
   * to that cart's choice. Shown as a read-only line here; the
   * shipping sheet owns the locked picker UI.
   */
  shippingLocked?: boolean;
  shippingLockedNotice?: string | null;
  /**
   * Which checkout architecture the order will be created under.
   * Server-derived (getCheckoutModel() in the page component) and
   * threaded down as a prop — lib/env reads process.env, so the
   * VALUE can't be computed in a client component.
   */
  checkoutModel?: CheckoutModel;
}

/**
 * Sticky order-summary card. Shipping selection and Add to Cart /
 * Proceed to checkout live on ShippingSheet (opened by tapping a
 * vendor) — this surface only mirrors the live totals while a
 * quote is selected, and prompts the buyer to pick a vendor when
 * nothing is.
 */
export function PriceDisplay({
  selectedQuote,
  selectedShipping,
  quantity,
  checkoutError,
  minimumFeeInfo,
  checkingMinimum,
  shippingLocked,
  shippingLockedNotice,
  checkoutModel = "single",
}: PriceDisplayProps) {
  // Sandbox mode is worth exactly one callout, and this is it: the card
  // with the checkout totals on it. The shipping sheet also wears the
  // chip (that's where the buttons are).
  const sandbox = useSandbox();

  if (!selectedQuote) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center">
            Pick a vendor to choose shipping and check out.
          </p>
        </CardContent>
      </Card>
    );
  }

  const materialCost = selectedQuote.price * quantity;
  const minimumFee = minimumFeeInfo?.minimumProductionFee ?? 0;
  const shippingCost = selectedShipping?.price ?? 0;
  // Service fee is 3% of material + production fee, NOT shipping —
  // freight shouldn't inflate our platform cut. Shipping sits in
  // its own line below and flows into total. calcServiceFee expects
  // integer cents and applies the two_step floor/cap the server
  // actually charges — single-sourced from lib/fees.ts rather than a
  // locally hardcoded rate so this display can't drift from what
  // Stripe authorizes.
  const preShipping = materialCost + minimumFee;
  const serviceFee =
    calcServiceFee(Math.round(preShipping * 100), checkoutModel) / 100;
  const total = preShipping + serviceFee + shippingCost;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Order Summary
          {sandbox && <SandboxBadge />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Material ({quantity}x)</span>
          <span>${materialCost.toFixed(2)}</span>
        </div>

        {minimumFee > 0 && (
          <div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Vendor minimum fee
              </span>
              <span>+${minimumFee.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              This vendor has a ${minimumFeeInfo!.vendorMinimumPrice.toFixed(2)}{" "}
              minimum production charge
            </p>
          </div>
        )}

        {checkingMinimum && selectedShipping && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-3 w-3 animate-spin rounded-full border border-muted border-t-foreground" />
            Checking vendor pricing...
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Shipping
            {shippingLocked ? " (locked)" : ""}
          </span>
          <span>
            {selectedShipping
              ? `$${shippingCost.toFixed(2)}`
              : "—"}
          </span>
        </div>
        {shippingLocked && shippingLockedNotice && (
          <p className="text-xs text-muted-foreground">
            {shippingLockedNotice}
          </p>
        )}
        {selectedShipping && (
          <p className="text-xs text-muted-foreground">
            {selectedShipping.name} · {selectedShipping.deliveryTime} days
          </p>
        )}

        <Separator />

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Service fee (3%)</span>
          <span>${serviceFee.toFixed(2)}</span>
        </div>

        <Separator />

        <div className="flex justify-between font-semibold" aria-live="polite" aria-atomic="true">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>

        {checkoutError && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {checkoutError}
          </p>
        )}

        {checkoutModel === "two_step" && (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            You&apos;ll see two charges: a hold for the Materialize service
            fee shown above (only charged once your order is placed) and
            CraftCloud&apos;s charge for production + shipping.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
