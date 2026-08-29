"use client";

import { useEffect, useState } from "react";
import type { CheckoutModel } from "@/lib/env";
import { NativeSheet } from "@/components/ui/native-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SandboxBadge } from "@/components/sandbox-badge";
import { useSandbox } from "@/components/sandbox-context";
import { calcServiceFee } from "@/lib/fees";
import { ShippingDrop } from "./shipping-drop";
import { AddressHome } from "./address-home";
import {
  ShippingAddressForm,
  type SavedCheckoutAddress,
} from "./shipping-address-form";
import {
  shippingOptionsForVendor,
  type ShippingOption,
} from "./shipping-options";
import type { MinimumFeeInfo } from "./price-display";

/**
 * Dynamic checkout sheet opened by tapping a vendor quote.
 *
 * Steps:
 *   shipping — parachute-box hero, delivery dropdown (cheapest
 *              pre-selected by the parent), summary, Add to Cart /
 *              Proceed to checkout
 *   address  — cartoon-home hero + saved-address / address form
 *              (anon OTP lives inside the form)
 *
 * Closing the sheet at any step cancels the pick — parent clears
 * selectedQuote + selectedShipping so the buyer is back on the
 * vendor list with nothing selected. Fee / saved-card sheets still
 * stack on top after address submit (existing payment chrome).
 */

export type CheckoutSheetStep = "shipping" | "address";

export interface ShippingSheetQuote {
  quoteId: string;
  vendorId: string;
  vendorName: string;
  price: number;
  currency: string;
}

type AddressSubmitData = {
  email: string;
  shipping: SavedCheckoutAddress["shipping"];
  billing: SavedCheckoutAddress["billing"];
};

interface ShippingSheetProps {
  open: boolean;
  step: CheckoutSheetStep;
  onStepChange: (step: CheckoutSheetStep) => void;
  quote: ShippingSheetQuote | null;
  shipping: ShippingOption[];
  selectedShipping: ShippingOption | null;
  onSelectShipping: (option: ShippingOption) => void;
  quantity: number;
  onCheckout: () => void | Promise<void>;
  isCheckingOut: boolean;
  checkoutError?: string | null;
  onAddToCart?: () => void;
  isAddingToCart?: boolean;
  minimumFeeInfo?: MinimumFeeInfo | null;
  checkingMinimum?: boolean;
  shippingLocked?: boolean;
  shippingLockedNotice?: string | null;
  checkoutModel?: CheckoutModel;
  /** Address-step props — only needed once the buyer proceeds. */
  onAddressSubmit: (data: AddressSubmitData) => void;
  isSubmittingAddress: boolean;
  anonMode?: boolean;
  savedAddress?: SavedCheckoutAddress | null;
  /**
   * User dismissed the sheet (backdrop / Escape / drag). Parent
   * clears the vendor + shipping selection and resets the step.
   */
  onDismiss: () => void;
}

const EXIT_ANIMATION_MS = 300;

export function ShippingSheet({
  open,
  step,
  onStepChange,
  quote,
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
  onAddressSubmit,
  isSubmittingAddress,
  anonMode = false,
  savedAddress = null,
  onDismiss,
}: ShippingSheetProps) {
  const sandbox = useSandbox();
  // Local exiting flag lets the sheet animate out before the parent
  // clears the vendor pick. Do not mirror `open` into another piece
  // of state — a delayed copy can miss the first client open
  // (sandbox SSR + hydration) and then ignore a no-op setOpen(true).
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (open) setExiting(false);
  }, [open]);

  const busy = isCheckingOut || !!isAddingToCart || isSubmittingAddress;
  const visible = open && Boolean(quote) && !exiting;

  const dismiss = () => {
    if (busy) return;
    setExiting(true);
    setTimeout(onDismiss, EXIT_ANIMATION_MS);
  };

  if (!quote) return null;

  const vendorShipping = shippingOptionsForVendor(shipping, quote.vendorId);
  const materialCost = quote.price * quantity;
  const minimumFee = minimumFeeInfo?.minimumProductionFee ?? 0;
  const shippingCost = selectedShipping?.price ?? 0;
  const preShipping = materialCost + minimumFee;
  const serviceFee =
    calcServiceFee(Math.round(preShipping * 100), checkoutModel) / 100;
  const total = preShipping + serviceFee + shippingCost;

  return (
    <NativeSheet
      open={visible}
      onClose={dismiss}
      dismissible={!busy}
      ariaLabel={step === "address" ? "Shipping address" : "Choose shipping"}
    >
      <div className="px-6 pt-1 pb-1">
        {step === "shipping" ? (
          <>
            <div className="my-4">
              <ShippingDrop />
            </div>

            <div className="flex items-center gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Shipping
                </p>
                <h2 className="text-lg font-semibold leading-tight">
                  {quote.vendorName}
                </h2>
              </div>
              {sandbox && <SandboxBadge className="ml-auto" />}
            </div>

            <div className="mt-4 space-y-2">
              <Label htmlFor="shipping-select">Delivery option</Label>
              {shippingLocked && selectedShipping ? (
                <div>
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm">{selectedShipping.name}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({selectedShipping.deliveryTime} days)
                      </span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      ${selectedShipping.price.toFixed(2)}
                    </span>
                  </div>
                  {shippingLockedNotice && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {shippingLockedNotice}
                    </p>
                  )}
                </div>
              ) : vendorShipping.length === 0 ? (
                <p className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                  Shipping options are still loading for this vendor…
                </p>
              ) : (
                <Select
                  value={selectedShipping?.shippingId ?? null}
                  onValueChange={(value) => {
                    if (value == null) return;
                    const option = vendorShipping.find(
                      (s) => s.shippingId === value
                    );
                    if (option) onSelectShipping(option);
                  }}
                >
                  <SelectTrigger id="shipping-select" className="w-full">
                    <SelectValue placeholder="Select shipping">
                      {(value) => {
                        const option = vendorShipping.find(
                          (s) => s.shippingId === value
                        );
                        if (!option) return "Select shipping";
                        return (
                          <>
                            <span className="truncate">{option.name}</span>
                            <span className="text-muted-foreground">
                              ({option.deliveryTime}d)
                            </span>
                            <span className="ml-auto tabular-nums">
                              ${option.price.toFixed(2)}
                            </span>
                          </>
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {vendorShipping.map((option) => (
                      <SelectItem
                        key={option.shippingId}
                        value={option.shippingId}
                      >
                        <span>{option.name}</span>
                        <span className="text-muted-foreground">
                          ({option.deliveryTime} days)
                        </span>
                        <span className="ml-auto tabular-nums">
                          ${option.price.toFixed(2)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="mt-5 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Material ({quantity}x)
                </span>
                <span className="tabular-nums">
                  ${materialCost.toFixed(2)}
                </span>
              </div>

              {minimumFee > 0 && (
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Vendor minimum fee
                    </span>
                    <span className="tabular-nums">
                      +${minimumFee.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    This vendor has a $
                    {minimumFeeInfo!.vendorMinimumPrice.toFixed(2)} minimum
                    production charge
                  </p>
                </div>
              )}

              {checkingMinimum && selectedShipping && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border border-muted border-t-foreground" />
                  Checking vendor pricing…
                </div>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shipping</span>
                <span className="tabular-nums">
                  {selectedShipping ? `$${shippingCost.toFixed(2)}` : "—"}
                </span>
              </div>

              <Separator />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Service fee (3%)</span>
                <span className="tabular-nums">${serviceFee.toFixed(2)}</span>
              </div>

              <Separator />

              <div
                className="flex justify-between font-semibold"
                aria-live="polite"
                aria-atomic="true"
              >
                <span>Total</span>
                <span className="tabular-nums">${total.toFixed(2)}</span>
              </div>
            </div>

            {checkoutError && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                {checkoutError}
              </p>
            )}

            {checkoutModel === "two_step" && (
              <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                You&apos;ll see two charges: a hold for the Materialize
                service fee shown above (only charged once your order is
                placed) and CraftCloud&apos;s charge for production +
                shipping.
              </p>
            )}

            <div className="mt-4 space-y-2.5">
              {onAddToCart && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
                  onClick={onAddToCart}
                  disabled={!selectedShipping || busy}
                  loading={!!isAddingToCart}
                >
                  Add to Cart
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={onCheckout}
                disabled={!selectedShipping || busy}
                loading={isCheckingOut}
              >
                Proceed to checkout
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="my-4">
              <AddressHome />
            </div>
            <ShippingAddressForm
              embedded
              onSubmit={onAddressSubmit}
              onBack={() => onStepChange("shipping")}
              isSubmitting={isSubmittingAddress}
              anonMode={anonMode}
              savedAddress={anonMode ? null : savedAddress}
            />
          </>
        )}
      </div>
    </NativeSheet>
  );
}
