"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useCart } from "./cart-context";

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
  const subtotal = materialCost + minimumFee + shippingCost;
  const serviceFee = subtotal * SERVICE_FEE_RATE;
  const total = subtotal + serviceFee;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Order Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ExistingCartSummary currentVendorId={selectedQuote.vendorId} />

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
          <RadioGroup
            value={selectedShipping?.shippingId ?? ""}
            onValueChange={(value) => {
              const option = vendorShipping.find((s) => s.shippingId === value);
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
        </div>

        <Separator />

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Service fee (3%)</span>
          <span>${serviceFee.toFixed(2)}</span>
        </div>

        <Separator />

        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>

        {checkoutError && (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {checkoutError}
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

/**
 * Shows the user's other cart groupings so they can see — while
 * picking a vendor for a new print — whether the selection will
 * consolidate into an existing group (one checkout) or spin up a
 * new vendor group (separate checkout). The row matching the
 * currently-selected vendor is highlighted.
 *
 * Hidden entirely when the cart is empty or the cart context
 * isn't available (e.g. legacy callers outside CartProvider).
 */
function ExistingCartSummary({
  currentVendorId,
}: {
  currentVendorId: string;
}) {
  const cart = useCart();

  const vendorGroups = useMemo(() => {
    if (!cart) return [];
    const groups = new Map<
      string,
      {
        vendorId: string;
        vendorName: string | null;
        count: number;
        subtotalCents: number;
      }
    >();

    // DB cart items — prices already stored in cents.
    for (const item of cart.items) {
      const itemTotal =
        item.materialPrice * item.quantity + item.shippingPrice;
      const existing = groups.get(item.vendorId);
      if (existing) {
        existing.count += item.quantity;
        existing.subtotalCents += itemTotal;
        if (!existing.vendorName && item.vendorName) {
          existing.vendorName = item.vendorName;
        }
      } else {
        groups.set(item.vendorId, {
          vendorId: item.vendorId,
          vendorName: item.vendorName,
          count: item.quantity,
          subtotalCents: itemTotal,
        });
      }
    }

    // Local anon cart items — prices in dollars, convert to cents.
    for (const item of cart.localItems) {
      const itemTotalCents = Math.round(
        (item.materialPrice * item.quantity + item.shippingPrice) * 100
      );
      const existing = groups.get(item.vendorId);
      if (existing) {
        existing.count += item.quantity;
        existing.subtotalCents += itemTotalCents;
        if (!existing.vendorName && item.vendorName) {
          existing.vendorName = item.vendorName;
        }
      } else {
        groups.set(item.vendorId, {
          vendorId: item.vendorId,
          vendorName: item.vendorName ?? null,
          count: item.quantity,
          subtotalCents: itemTotalCents,
        });
      }
    }

    return Array.from(groups.values());
  }, [cart]);

  if (vendorGroups.length === 0) return null;

  const matchesCurrent = vendorGroups.some(
    (g) => g.vendorId === currentVendorId
  );

  return (
    <div className="space-y-2 pb-1">
      <p className="text-xs font-medium text-muted-foreground">In your cart</p>
      <div className="space-y-1.5">
        {vendorGroups.map((g) => {
          const isCurrent = g.vendorId === currentVendorId;
          return (
            <div
              key={g.vendorId}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs ${
                isCurrent
                  ? "border border-primary/30 bg-primary/5"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">
                  {g.vendorName ?? g.vendorId}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  ({g.count} {g.count === 1 ? "item" : "items"})
                </span>
                {isCurrent && (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary">
                    same vendor
                  </span>
                )}
              </div>
              <span className="shrink-0 tabular-nums">
                ${(g.subtotalCents / 100).toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {matchesCurrent
          ? "Adding to cart will group this print with the same vendor — one checkout."
          : "This vendor isn't in your cart yet — adding it creates a separate checkout."}
      </p>
      <Separator />
    </div>
  );
}
