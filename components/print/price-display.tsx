"use client";

import type { CheckoutModel } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const SERVICE_FEE_RATE = 0.03;

interface Quote {
  quoteId: string;
  vendorId: string;
  materialConfigId: string;
  price: number;
  currency: string;
}

interface ShippingOption {
  shippingId: string;
  vendorId: string;
  name: string;
  deliveryTime: number;
  price: number;
  type: "standard" | "express";
}

export interface MinimumFeeInfo {
  /** Dollars — extra fee added to reach the vendor's minimum (0 if none). */
  minimumProductionFee: number;
  /** Dollars — the vendor's minimum production price (0 if none). */
  vendorMinimumPrice: number;
}

interface PriceDisplayProps {
  selectedQuote: Quote | null;
  shipping: ShippingOption[];
  selectedShipping: ShippingOption | null;
  onSelectShipping: (option: ShippingOption) => void;
  quantity: number;
  onCheckout: () => void;
  isCheckingOut: boolean;
  checkoutError?: string | null;
  onAddToCart?: () => void;
  isAddingToCart?: boolean;
  /** Vendor minimum production fee info from checkCartPricing. */
  minimumFeeInfo?: MinimumFeeInfo | null;
  /** True while checkCartPricing is in flight. */
  checkingMinimum?: boolean;
  /**
   * When the configured vendor already has a cart, shipping is fixed
   * to that cart's choice (one shipping option per vendor order). The
   * picker renders read-only with an explanatory notice.
   */
  shippingLocked?: boolean;
  shippingLockedNotice?: string | null;
  /**
   * Which checkout architecture the order will be created under.
   * Server-derived (getCheckoutModel() in the page component) and
   * threaded down as a prop — lib/env reads process.env, so the
   * VALUE can't be computed in a client component. Under "two_step"
   * we owe the customer a heads-up that their card will see two
   * separate charges (our fee hold + CraftCloud's production
   * charge) before they hit the button.
   */
  checkoutModel?: CheckoutModel;
}

export function PriceDisplay({
  selectedQuote,
  shipping,
  selectedShipping,
  onSelectShipping,
  quantity,
  onCheckout,
  isCheckingOut,
  checkoutError,
  onAddToCart,
  isAddingToCart,
  minimumFeeInfo,
  checkingMinimum,
  shippingLocked,
  shippingLockedNotice,
  checkoutModel = "single",
}: PriceDisplayProps) {
  if (!selectedQuote) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center">
            Select a material to see pricing.
          </p>
        </CardContent>
      </Card>
    );
  }

  const vendorShipping = shipping.filter(
    (s) => s.vendorId === selectedQuote.vendorId
  );

  const materialCost = selectedQuote.price * quantity;
  const minimumFee = minimumFeeInfo?.minimumProductionFee ?? 0;
  const shippingCost = selectedShipping?.price ?? 0;
  // Service fee is 3% of material + production fee, NOT shipping —
  // freight shouldn't inflate our platform cut. Shipping sits in
  // its own line below and flows into total.
  const preShipping = materialCost + minimumFee;
  const serviceFee = preShipping * SERVICE_FEE_RATE;
  const total = preShipping + serviceFee + shippingCost;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Order Summary</CardTitle>
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

        <div className="pt-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Shipping
          </p>
          {shippingLocked && selectedShipping ? (
            // One shipping option per vendor cart — render the inherited
            // choice read-only so the user isn't asked to re-pick (and
            // can't split the vendor group across two shipping methods).
            <div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
                <div>
                  <span className="text-sm">{selectedShipping.name}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({selectedShipping.deliveryTime} days)
                  </span>
                </div>
                <span className="text-sm font-medium">
                  ${selectedShipping.price.toFixed(2)}
                </span>
              </div>
              {shippingLockedNotice && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {shippingLockedNotice}
                </p>
              )}
            </div>
          ) : (
            <RadioGroup
              value={selectedShipping?.shippingId ?? ""}
              onValueChange={(value) => {
                const option = vendorShipping.find(
                  (s) => s.shippingId === value
                );
                if (option) onSelectShipping(option);
              }}
            >
              {vendorShipping.map((option) => (
                <Label
                  key={option.shippingId}
                  htmlFor={option.shippingId}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-border p-3 transition-colors has-[[data-state=checked]]:border-primary"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value={option.shippingId}
                      id={option.shippingId}
                    />
                    <div>
                      <span className="text-sm">{option.name}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({option.deliveryTime} days)
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-medium">
                    ${option.price.toFixed(2)}
                  </span>
                </Label>
              ))}
            </RadioGroup>
          )}
        </div>

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
            You&apos;ll see two charges: a hold for the 3% service fee (only
            charged once your order is placed) and CraftCloud&apos;s charge for
            production + shipping.
          </p>
        )}

        {onAddToCart && (
          <Button
            variant="outline"
            onClick={onAddToCart}
            disabled={!selectedShipping || isAddingToCart}
            className="w-full mt-2"
            size="lg"
          >
            {isAddingToCart ? "Adding..." : "Add to Cart"}
          </Button>
        )}

        <Button
          onClick={onCheckout}
          disabled={!selectedShipping || isCheckingOut}
          className="w-full mt-2"
          size="lg"
        >
          {isCheckingOut ? "Processing..." : "Proceed to checkout"}
        </Button>
      </CardContent>
    </Card>
  );
}
