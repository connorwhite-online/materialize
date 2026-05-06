"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { confirmAgentInitiatedOrder } from "@/app/actions/agent-orders";

interface Props {
  orderId: string;
  confirmationToken: string;
}

export function ConfirmOrderForm({ orderId, confirmationToken }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await confirmAgentInitiatedOrder({
        orderId,
        confirmationToken,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      window.location.href = result.checkoutUrl;
    });
  };

  return (
    <div className="space-y-2">
      <Button size="lg" onClick={onConfirm} disabled={isPending} className="w-full">
        {isPending ? "Preparing checkout…" : "Confirm and pay"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
