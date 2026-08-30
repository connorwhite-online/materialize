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
    <div className="flex w-full flex-col gap-1">
      <div
        className={
          hasCard ? "grid w-full grid-cols-2 gap-2" : "flex w-full"
        }
      >
        {hasCard && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleRemove}
            disabled={pending}
          >
            Remove
          </Button>
        )}
        <Button
          onClick={handleAddOrReplace}
          disabled={pending}
          size="sm"
          className="w-full"
        >
          {hasCard ? "Replace card" : "Add card"}
        </Button>
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
