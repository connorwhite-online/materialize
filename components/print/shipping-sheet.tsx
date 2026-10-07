"use client";

import { useEffect, useState } from "react";
import type { CheckoutModel } from "@/lib/env";
import { NativeSheet } from "@/components/ui/native-sheet";
import { Button } from "@/components/ui/button";
import { SummaryRow } from "@/components/ui/summary-list";
import { DottedSpinner } from "@/components/icons/dotted-spinner";
import { TwoChargesNote } from "./two-charges-note";
import { cn } from "@/lib/utils";
import { SandboxBadge } from "@/components/sandbox-badge";
import { useSandbox } from "@/components/sandbox-context";
import { calcServiceFee } from "@/lib/fees";
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
 *   shipping — delivery dropdown (cheapest pre-selected by the
 *              parent), summary, Add to Cart / Proceed to checkout
 *   address  — saved-address / address form (anon OTP lives inside
 *              the form)
 *
 * Closing the sheet at any step cancels the pick — parent clears
 * selectedQuote + selectedShipping so the buyer is back on the
 * vendor list with nothing selected. Fee / saved-card sheets still
 * stack on top after address submit (existing payment chrome).
 *
 * Sheet 3D heroes were cut — reintroduce later when the models are
 * ready; keep the fee-sheet PaymentCard as the pattern to follow.
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
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Ships from
                </p>
                <h2 className="truncate text-lg leading-6 font-semibold">
                  {quote.vendorName}
                </h2>
              </div>
              {sandbox && <SandboxBadge className="mt-1" />}
            </div>

            <section aria-labelledby="delivery-heading" className="flex flex-col gap-2">
              <h3 id="delivery-heading" className="text-sm leading-5 font-semibold">
                Delivery
              </h3>
              {shippingLocked && selectedShipping ? (
                <div>
                  <DeliveryOptionRow option={selectedShipping} selected locked />
                  {shippingLockedNotice && (
                    <p className="mt-1.5 text-[13px] leading-[18px] text-muted-foreground">
                      {shippingLockedNotice}
                    </p>
                  )}
                </div>
              ) : vendorShipping.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
                  <DottedSpinner />
                  Loading delivery options…
                </p>
              ) : (
                // A handful of options with a price and a speed each —
                // radio rows show every trade-off at once, where the old
                // dropdown hid all but the pre-selected one.
                <div
                  role="radiogroup"
                  aria-labelledby="delivery-heading"
                  className="flex flex-col gap-1.5"
                  onKeyDown={(e) => {
                    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) return;
                    e.preventDefault();
                    const idx = vendorShipping.findIndex(
                      (s) => s.shippingId === selectedShipping?.shippingId
                    );
                    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
                    const next =
                      vendorShipping[
                        (idx + step + vendorShipping.length) % vendorShipping.length
                      ];
                    onSelectShipping(next);
                    const el = e.currentTarget.querySelector<HTMLElement>(
                      `[data-shipping-id="${next.shippingId}"]`
                    );
                    el?.focus();
                  }}
                >
                  {vendorShipping.map((option, i) => {
                    const isSelected =
                      option.shippingId === selectedShipping?.shippingId;
                    const focusable = selectedShipping
                      ? isSelected
                      : i === 0;
                    return (
                      <DeliveryOptionRow
                        key={option.shippingId}
                        option={option}
                        selected={isSelected}
                        tabIndex={focusable ? 0 : -1}
                        onSelect={() => onSelectShipping(option)}
                      />
                    );
                  })}
                </div>
              )}
            </section>

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
                label="Shipping"
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
                className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] leading-[18px] text-destructive"
              >
                {checkoutError}
              </p>
            )}

            {checkoutModel === "two_step" && <TwoChargesNote />}

            <div className="flex gap-2">
              {onAddToCart && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={onAddToCart}
                  disabled={!selectedShipping || busy}
                  loading={!!isAddingToCart}
                >
                  Add to cart
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={onCheckout}
                disabled={!selectedShipping || busy}
                loading={isCheckingOut}
              >
                Proceed to checkout
              </Button>
            </div>
          </div>
        ) : (
          <>
          {/* A failed checkout lands back on this step (the configurator
              reopens the address form), so the error has to show here
              too — otherwise the form just reappears with no reason. */}
          {checkoutError && (
            <p
              role="alert"
              className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] leading-[18px] text-destructive"
            >
              {checkoutError}
            </p>
          )}
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

function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/**
 * One delivery choice: name + speed left, price right, a check when
 * selected. Selected = soft fill, not a heavy border (DESIGN_SYSTEM §
 * Lists and rows).
 */
function DeliveryOptionRow({
  option,
  selected,
  locked = false,
  tabIndex,
  onSelect,
}: {
  option: ShippingOption;
  selected: boolean;
  locked?: boolean;
  tabIndex?: number;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input"
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-5 font-medium">
          {option.name}
        </span>
        <span className="block text-[13px] leading-[18px] text-muted-foreground">
          {option.deliveryTime} {option.deliveryTime === 1 ? "day" : "days"}
          {locked ? " · fixed by your cart" : ""}
        </span>
      </span>
      <span className="shrink-0 text-sm font-medium tabular-nums">
        {money(option.price)}
      </span>
    </>
  );
  const base =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-[background-color,box-shadow] duration-150";
  if (locked || !onSelect) {
    return (
      <div className={cn(base, "bg-muted/60 ring-transparent")}>{body}</div>
    );
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      data-shipping-id={option.shippingId}
      onClick={onSelect}
      className={cn(
        base,
        "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-muted ring-foreground/15"
          : "ring-border hover:bg-muted/60"
      )}
    >
      {body}
    </button>
  );
}
