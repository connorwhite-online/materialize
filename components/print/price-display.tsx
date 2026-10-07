"use client";

import type { CheckoutModel } from "@/lib/env";
import { Card } from "@/components/ui/card";
import { SummaryRow } from "@/components/ui/summary-list";
import { DottedSpinner } from "@/components/icons/dotted-spinner";
import { TwoChargesNote } from "./two-charges-note";
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
      <div className="rounded-2xl bg-muted/60 px-5 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          Pick a vendor to choose shipping and check out.
        </p>
      </div>
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

  const money = (dollars: number) => `$${dollars.toFixed(2)}`;

  return (
    <Card className="gap-0 px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm leading-5 font-semibold">Order summary</h2>
        {sandbox && <SandboxBadge />}
      </div>
      <dl className="flex flex-col gap-2.5 text-sm">
      <SummaryRow
        label={`Material${quantity > 1 ? ` × ${quantity}` : ""}`}
        value={money(materialCost)}
      />
      {minimumFee > 0 && (
        <SummaryRow
          label={
            <>
              Vendor minimum
              <span className="block text-xs text-subtle-foreground">
                This shop&apos;s minimum order is{" "}
                {money(minimumFeeInfo!.vendorMinimumPrice)}
              </span>
            </>
          }
          value={money(minimumFee)}
        />
      )}
      <SummaryRow
        label={
          <>
            Shipping{shippingLocked ? " (locked)" : ""}
            {selectedShipping && (
              <span className="block text-xs text-subtle-foreground">
                {selectedShipping.name} · {selectedShipping.deliveryTime} days
              </span>
            )}
            {shippingLocked && shippingLockedNotice && (
              <span className="block text-xs text-subtle-foreground">
                {shippingLockedNotice}
              </span>
            )}
          </>
        }
        value={selectedShipping ? money(shippingCost) : "—"}
      />
      <SummaryRow label="Service fee (3%)" value={money(serviceFee)} />
      <div aria-live="polite" aria-atomic="true">
        <SummaryRow
          total
          label="Total"
          value={
            checkingMinimum && selectedShipping ? (
              <span className="inline-flex items-center gap-2 text-sm font-normal text-muted-foreground">
                <DottedSpinner />
                Checking price…
              </span>
            ) : (
              money(total)
            )
          }
        />
      </div>
      </dl>

      {checkoutError && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] leading-[18px] text-destructive"
        >
          {checkoutError}
        </p>
      )}

      {checkoutModel === "two_step" && <TwoChargesNote className="mt-3" />}
    </Card>
  );
}
