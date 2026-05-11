"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  createStripePayoutOnboardingLink,
  createStripePayoutDashboardLink,
} from "@/app/actions/payouts";

interface Props {
  connected: boolean;
  onboarded: boolean;
}

/**
 * Client wrapper for the payout setup / dashboard buttons. The actual
 * Stripe URL is minted server-side via `createStripePayout*Link` —
 * we just redirect on click.
 */
export function PayoutActions({ connected, onboarded }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const startOnboarding = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createStripePayoutOnboardingLink();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      window.location.href = res.url;
    });
  };

  const openDashboard = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createStripePayoutDashboardLink();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      window.location.href = res.url;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!onboarded && (
          <Button onClick={startOnboarding} disabled={pending}>
            {pending
              ? "Opening Stripe…"
              : connected
                ? "Finish onboarding"
                : "Set up payouts"}
          </Button>
        )}
        {connected && (
          <Button
            variant="outline"
            onClick={openDashboard}
            disabled={pending}
          >
            Open Stripe dashboard
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
