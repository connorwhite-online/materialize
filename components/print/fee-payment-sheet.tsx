"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import { useTheme } from "next-themes";
import { NativeSheet } from "@/components/ui/native-sheet";
import { getStripeBrowser } from "@/lib/stripe/browser";
import { finalizeFeeAuthorization } from "@/app/actions/print";

/**
 * The embedded service-fee sheet: confirms the manual-capture
 * PaymentIntent minted by prepareEmbeddedFeeSheet without ever
 * leaving the page, then finalizes server-side and forwards the
 * buyer to CraftCloud's production payment. The whole point is that
 * the fee no longer costs a redirect — the only external page left
 * in two-step checkout is CraftCloud's own.
 *
 * State machine: idle → confirming (Stripe.js, card/Apple Pay)
 * → finalizing (server verifies the hold + advances the order)
 * → redirecting. If confirm succeeded but finalize failed, we retry
 * ONLY the finalize on the next tap — re-confirming an authorized PI
 * would error. The webhook backstop
 * (payment_intent.amount_capturable_updated) advances the order
 * anyway if the buyer closes the tab mid-finalize.
 */

export interface FeeSheetPayload {
  clientSecret: string;
  orderId: string;
  amountCents: number;
}

interface FeePaymentSheetProps {
  sheet: FeeSheetPayload | null;
  /** Called after the sheet fully dismisses without completing payment. */
  onClose: () => void;
}

const EXIT_ANIMATION_MS = 300;

export function FeePaymentSheet({ sheet, onClose }: FeePaymentSheetProps) {
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setOpen(Boolean(sheet));
    setLocked(false);
  }, [sheet]);

  const stripePromise = useMemo(() => getStripeBrowser(), []);

  const appearance = useMemo<Appearance>(
    () => ({
      theme: resolvedTheme === "dark" ? "night" : "stripe",
      variables: {
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
        fontSizeBase: "15px",
        borderRadius: "14px",
        ...(resolvedTheme === "dark"
          ? {
              colorPrimary: "#fafafa",
              colorBackground: "#1c1c1e",
              colorText: "#f5f5f7",
              colorDanger: "#ff6369",
            }
          : {
              colorPrimary: "#111113",
              colorBackground: "#ffffff",
              colorText: "#1d1d1f",
              colorDanger: "#dc2626",
            }),
      },
      rules: {
        ".Input": { boxShadow: "none" },
        ".Tab, .Input, .Block": { border: "1px solid rgba(127,127,127,.25)" },
      },
    }),
    [resolvedTheme]
  );

  const dismiss = () => {
    if (locked) return;
    setOpen(false);
    setTimeout(onClose, EXIT_ANIMATION_MS);
  };

  if (!sheet) return null;

  return (
    <NativeSheet
      open={open}
      onClose={dismiss}
      dismissible={!locked}
      ariaLabel="Pay service fee"
    >
      <div className="px-6 pt-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Service fee
        </p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums">
          {fmt(sheet.amountCents)}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Held now, charged only when your order is placed. Production and
          shipping are paid to CraftCloud in the next step.
        </p>

        <Elements
          key={sheet.clientSecret}
          stripe={stripePromise}
          options={{ clientSecret: sheet.clientSecret, appearance }}
        >
          <FeeForm
            orderId={sheet.orderId}
            amountCents={sheet.amountCents}
            onLockChange={setLocked}
          />
        </Elements>
      </div>
    </NativeSheet>
  );
}

function FeeForm({
  orderId,
  amountCents,
  onLockChange,
}: {
  orderId: string;
  amountCents: number;
  onLockChange: (locked: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [phase, setPhase] = useState<
    "idle" | "confirming" | "finalizing" | "redirecting"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [elementReady, setElementReady] = useState(false);
  // Set once confirmPayment succeeds: from then on, taps retry only
  // the server finalize — the hold already exists on the card.
  const confirmedRef = useRef(false);

  const busy = phase !== "idle";

  const setPhaseLocked = (next: typeof phase) => {
    setPhase(next);
    onLockChange(next !== "idle");
  };

  const finalize = async () => {
    setPhaseLocked("finalizing");
    const result = await finalizeFeeAuthorization(orderId);
    if ("error" in result) {
      setError(result.error);
      setPhaseLocked("idle");
      return;
    }
    setPhaseLocked("redirecting");
    window.location.href = result.productionPaymentUrl;
  };

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (confirmedRef.current) {
      await finalize();
      return;
    }

    if (!stripe || !elements) return;
    setPhaseLocked("confirming");

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment(
      {
        elements,
        // No redirect-based methods are offered (the PI was created
        // with allow_redirects: "never"), so this never navigates —
        // the return_url is a Stripe API requirement, satisfied with
        // the tokenless landing as a safety net.
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/orders/${orderId}/pay-production?fee=authorized`,
        },
      }
    );

    if (confirmError) {
      setError(
        confirmError.message ?? "Payment didn't go through. Please try again."
      );
      setPhaseLocked("idle");
      return;
    }
    if (
      paymentIntent?.status !== "requires_capture" &&
      paymentIntent?.status !== "succeeded"
    ) {
      setError("Payment didn't complete. Please try again.");
      setPhaseLocked("idle");
      return;
    }

    confirmedRef.current = true;
    await finalize();
  };

  return (
    <div className="mt-4 space-y-4">
      <PaymentElement
        onReady={() => setElementReady(true)}
        options={{ layout: "accordion" }}
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!elementReady || busy}
        className="w-full rounded-2xl bg-primary px-4 py-3.5 text-center text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {phase === "confirming" && "Authorizing…"}
        {phase === "finalizing" && "Confirming…"}
        {phase === "redirecting" && "Continuing to CraftCloud…"}
        {phase === "idle" &&
          (confirmedRef.current
            ? "Continue"
            : `Authorize ${fmt(amountCents)}`)}
      </button>

      <p className="text-center text-[11px] text-muted-foreground">
        Your card details are handled by Stripe and saved for one-tap
        checkout next time.
      </p>
    </div>
  );
}

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
