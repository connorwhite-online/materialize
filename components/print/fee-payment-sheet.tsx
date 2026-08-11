"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheckIcon, CreditCardIcon } from "lucide-react";
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
  /** Buyer email — prefills the Payment Element's billing details. */
  email?: string;
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
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400"
          >
            <CreditCardIcon className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Service fee
            </p>
            <p className="text-3xl font-bold tabular-nums">
              {fmt(sheet.amountCents)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
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
            email={sheet.email}
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
  email,
  onLockChange,
}: {
  orderId: string;
  amountCents: number;
  email?: string;
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
        // No redirect-based methods are offered (the PI is pinned to
        // card only), so this never navigates —
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
        options={{
          layout: "accordion",
          // Prefill billing details with the email from the shipping
          // form so nothing in the sheet asks for it a second time.
          defaultValues: email
            ? { billingDetails: { email } }
            : undefined,
          // Suppress Stripe's injected "you allow Materialize to
          // charge your card…" legalese — the one-line disclosure
          // below the button covers it and keeps the sheet short.
          terms: { card: "never" },
        }}
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

/**
 * Confirmation sheet for the one-tap saved-card path: shows the
 * saved method and asks before anything is charged. The server
 * refuses to run the one-tap authorization without feePayment:
 * "saved_card", so this sheet is the only way a saved card gets
 * used. "Use a different card" re-calls checkout with feePayment:
 * "new_card" and the parent swaps in the Payment Element sheet.
 */
export interface SavedCardConfirmPayload {
  orderId: string;
  amountCents: number;
  /** Card brand ("visa", "mastercard", …) or PM type ("link"). */
  brand: string;
  /** Last four digits; null for non-card methods (Link). */
  last4: string | null;
}

interface SavedCardFeeSheetProps {
  confirm: SavedCardConfirmPayload | null;
  /**
   * Authorize the fee on the saved method. On success the parent
   * redirects (never resolves in practice) or swaps sheets; resolve
   * with { error } to surface a message and unlock the buttons.
   */
  onAuthorize: () => Promise<{ error: string } | void>;
  /** Switch to the Payment Element sheet (parent swaps payloads). */
  onUseDifferentCard: () => Promise<{ error: string } | void>;
  /** Called after the sheet fully dismisses without a choice. */
  onClose: () => void;
}

export function SavedCardFeeSheet({
  confirm,
  onAuthorize,
  onUseDifferentCard,
  onClose,
}: SavedCardFeeSheetProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "authorizing" | "switching">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(Boolean(confirm));
    setPhase("idle");
    setError(null);
  }, [confirm]);

  const dismiss = () => {
    if (phase !== "idle") return;
    setOpen(false);
    setTimeout(onClose, EXIT_ANIMATION_MS);
  };

  if (!confirm) return null;

  const run = async (action: "authorize" | "switch") => {
    if (phase !== "idle") return;
    setError(null);
    setPhase(action === "authorize" ? "authorizing" : "switching");
    const result =
      action === "authorize" ? await onAuthorize() : await onUseDifferentCard();
    if (result && "error" in result) {
      setError(result.error);
      setPhase("idle");
    }
    // On success the parent navigates or unmounts this sheet — keep
    // the phase locked so a stray tap can't double-fire meanwhile.
  };

  return (
    <NativeSheet
      open={open}
      onClose={dismiss}
      dismissible={phase === "idle"}
      ariaLabel="Confirm service fee"
    >
      <div className="px-6 pt-1">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400"
          >
            <CreditCardIcon className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Service fee
            </p>
            <p className="text-3xl font-bold tabular-nums">
              {fmt(confirm.amountCents)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Held now, charged only when your order is placed. Production and
          shipping are paid to CraftCloud in the next step.
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border/60 px-4 py-3.5">
          <BadgeCheckIcon
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400"
            strokeWidth={2.5}
          />
          <span className="text-[15px] font-medium">
            {savedMethodLabel(confirm)}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">Saved</span>
        </div>

        <div className="mt-4 space-y-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => run("authorize")}
            disabled={phase !== "idle"}
            className="w-full rounded-2xl bg-primary px-4 py-3.5 text-center text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {phase === "authorizing"
              ? "Authorizing…"
              : `Authorize ${fmt(confirm.amountCents)}`}
          </button>

          <button
            type="button"
            onClick={() => run("switch")}
            disabled={phase !== "idle"}
            className="w-full rounded-2xl px-4 py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {phase === "switching" ? "One moment…" : "Use a different card"}
          </button>
        </div>
      </div>
    </NativeSheet>
  );
}

function savedMethodLabel({
  brand,
  last4,
}: Pick<SavedCardConfirmPayload, "brand" | "last4">): string {
  const name =
    brand === "link"
      ? "Link"
      : brand.charAt(0).toUpperCase() + brand.slice(1);
  return last4 ? `${name} •••• ${last4}` : name;
}
