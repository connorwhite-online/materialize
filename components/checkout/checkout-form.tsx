"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SummaryRow, formatUsd } from "@/components/ui/summary-list";
import { SandboxBadge } from "@/components/sandbox-badge";
import { useSandbox } from "@/components/sandbox-context";
import { ShippingAddressForm } from "@/components/print/shipping-address-form";
import {
  FeePaymentSheet,
  SavedCardFeeSheet,
  type FeeSheetPayload,
  type SavedCardConfirmPayload,
} from "@/components/print/fee-payment-sheet";
import { completePrintOrder } from "@/app/actions/print";

/** Address payload the shipping form submits — also stashed for the
 * saved-card confirmation re-call. */
type CheckoutAddressData = {
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
};

export interface CheckoutItem {
  fileName: string | null;
  originalFilename: string | null;
  quantity: number;
  /** Unit price in cents. */
  materialSubtotal: number;
}

interface CheckoutFormProps {
  orderId: string;
  items: CheckoutItem[];
  /**
   * Order-level shipping total in cents. Lives on printOrders, not
   * on individual items, so same-vendor multi-item orders don't
   * double-charge the shipping fee.
   */
  shippingTotal: number;
  /** Vendor minimum production fee, in cents. */
  productionFee: number;
  /** Total print price (incl. production fee + shipping), in cents. */
  totalPrice: number;
  /** Platform fee (3%), in cents. */
  serviceFee: number;
}

export function CheckoutForm({
  orderId,
  items,
  shippingTotal,
  productionFee,
  totalPrice,
  serviceFee,
}: CheckoutFormProps) {
  const router = useRouter();
  const sandbox = useSandbox();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeSheet, setFeeSheet] = useState<FeeSheetPayload | null>(null);
  // Saved-card confirmation — the server stops before charging when
  // a saved method exists; the re-call needs the submitted address.
  const [savedCardConfirm, setSavedCardConfirm] = useState<{
    payload: SavedCardConfirmPayload;
    address: CheckoutAddressData;
  } | null>(null);
  // Synchronous guard — parent's `submitting` state only flips on
  // next render, so a rapid double-click could call
  // completePrintOrder twice and mint two Stripe sessions for the
  // same order.
  const submittingRef = useRef(false);

  const resumeWithFeePayment = async (
    feePayment: "saved_card" | "new_card"
  ): Promise<{ error: string } | void> => {
    if (!savedCardConfirm) return { error: "Nothing to confirm." };
    const { payload, address } = savedCardConfirm;
    const result = await completePrintOrder({
      orderId: payload.orderId,
      email: address.email,
      shipping: address.shipping,
      billing: address.billing,
      feePayment,
    });
    if ("error" in result) return { error: result.error };
    if ("feeSheet" in result) {
      setFeeSheet(result.feeSheet);
      setSavedCardConfirm(null);
      return;
    }
    if ("checkoutUrl" in result) {
      window.location.href = result.checkoutUrl;
      return;
    }
    return { error: "Something went wrong. Please try again." };
  };

  const handleSubmit = async (data: CheckoutAddressData) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const result = await completePrintOrder({
        orderId,
        email: data.email,
        shipping: data.shipping,
        billing: data.billing,
      });

      if ("error" in result) {
        setError(result.error);
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }

      // Two-step embedded fee sheet — the flow pauses for user
      // input, so release the guards; closing the sheet re-enables
      // the form (resubmitting reopens the same PI idempotently).
      if ("feeSheet" in result) {
        setFeeSheet(result.feeSheet);
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }

      // Saved card on file — pause for explicit confirmation, same
      // release semantics as the fee sheet.
      if ("savedCardConfirm" in result) {
        setSavedCardConfirm({
          payload: result.savedCardConfirm,
          address: data,
        });
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }

      // Successful redirect — leave the ref set so a stray late
      // click can't re-enter before navigation happens.
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const money = (cents: number) => formatUsd(cents);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
      <FeePaymentSheet sheet={feeSheet} onClose={() => setFeeSheet(null)} />
      <SavedCardFeeSheet
        confirm={savedCardConfirm?.payload ?? null}
        onAuthorize={() => resumeWithFeePayment("saved_card")}
        onUseDifferentCard={() => resumeWithFeePayment("new_card")}
        onClose={() => setSavedCardConfirm(null)}
      />

      {/* Summary first in the DOM on phones (you check what you're
          paying for before typing an address); the right column on
          desktop. */}
      <div className="lg:sticky lg:top-20 lg:order-2">
        <Card className="gap-0 px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm leading-5 font-semibold">Order summary</h2>
            {sandbox && <SandboxBadge />}
          </div>
          <ul className="-mx-1 mb-3 flex flex-col">
            {items.map((item, idx) => {
              const name =
                item.fileName ??
                item.originalFilename?.replace(/\.[^.]+$/, "") ??
                "3D print";
              return (
                <li key={idx} className="flex items-center gap-3 px-1 py-1.5">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-[13px] font-medium text-muted-foreground tabular-nums"
                  >
                    ×{item.quantity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {name}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {money(item.materialSubtotal * item.quantity)}
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className="flex flex-col gap-2.5 border-t border-border pt-3 text-sm">
            {productionFee > 0 && (
              <SummaryRow
                label={
                  <>
                    Vendor minimum
                    <span className="block text-xs text-subtle-foreground">
                      Tops the order up to this shop&apos;s minimum
                    </span>
                  </>
                }
                value={money(productionFee)}
              />
            )}
            {shippingTotal > 0 && (
              <SummaryRow label="Shipping" value={money(shippingTotal)} />
            )}
            <SummaryRow label="Service fee (3%)" value={money(serviceFee)} />
            <SummaryRow
              total
              label="Total"
              value={money(totalPrice + serviceFee)}
            />
          </dl>
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:order-1">
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">{error}</AlertDescription>
          </Alert>
        )}
        <ShippingAddressForm
          onSubmit={handleSubmit}
          onBack={() => router.back()}
          isSubmitting={submitting}
        />
      </div>
    </div>
  );
}
