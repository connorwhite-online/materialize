"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cancelAutoApprovedOrder } from "@/app/actions/agent-orders";

interface Props {
  orderId: string;
  confirmationToken: string;
}

export function CancelOrderForm({ orderId, confirmationToken }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onCancel = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelAutoApprovedOrder({
        orderId,
        confirmationToken,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  };

  if (success) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Order cancelled.</p>
        <p className="text-muted-foreground">
          A refund is on its way to your saved card. Most banks reflect it
          within 5–10 business days.
        </p>
        <Link
          href="/dashboard/orders"
          className="inline-block underline hover:text-foreground"
        >
          View your orders →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        size="lg"
        variant="destructive"
        onClick={onCancel}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? "Cancelling…" : "Cancel and refund"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
