"use client";

import { useState, useTransition } from "react";
import {
  createBillingSetupSession,
  removePaymentMethod,
} from "@/app/actions/billing";
import { Button } from "@/components/ui/button";

export function BillingActions({ hasCard }: { hasCard: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAddOrReplace = () => {
    setError(null);
    startTransition(async () => {
      const result = await createBillingSetupSession();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      window.location.href = result.url;
    });
  };

  const handleRemove = () => {
    setError(null);
    if (
      !confirm(
        "Remove the saved card? Agents will fall back to email confirmation for every order."
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await removePaymentMethod();
      if ("error" in result) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={hasCard ? "secondary" : "default"}
          onClick={handleAddOrReplace}
          loading={pending}
        >
          {hasCard ? "Replace card" : "Add card"}
        </Button>
        {hasCard && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={handleRemove}
            disabled={pending}
          >
            Remove
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
