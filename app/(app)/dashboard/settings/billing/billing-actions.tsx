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
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {hasCard && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={pending}
          >
            Remove
          </Button>
        )}
        <Button onClick={handleAddOrReplace} disabled={pending} size="sm">
          {hasCard ? "Replace card" : "Add card"}
        </Button>
      </div>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
