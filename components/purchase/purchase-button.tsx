"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createListingCheckoutSession } from "@/app/actions/checkout";

interface Props {
  fileId?: string;
  projectId?: string;
  priceCents: number;
  label?: string;
  className?: string;
}

/**
 * Drop-in Purchase button for a paid listing. Calls
 * `createListingCheckoutSession` server action → redirects to the
 * Stripe-hosted checkout URL on success. Errors (creator hasn't
 * set up payouts, you already own it, etc.) surface inline below
 * the button so the buyer sees them without a toast system.
 */
export function PurchaseButton({
  fileId,
  projectId,
  priceCents,
  label,
  className,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createListingCheckoutSession({ fileId, projectId });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      // Full-page redirect to Stripe Checkout. Using
      // window.location instead of router.push because the URL is
      // off-origin.
      window.location.href = res.url;
    });
  };

  return (
    <div className={className}>
      <Button
        className="w-full"
        onClick={handleClick}
        disabled={pending}
      >
        {pending
          ? "Opening checkout…"
          : label ?? `Purchase · $${(priceCents / 100).toFixed(2)}`}
      </Button>
      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
