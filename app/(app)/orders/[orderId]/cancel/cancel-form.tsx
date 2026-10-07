"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
      <Alert variant="success">
        <AlertTitle>Order cancelled</AlertTitle>
        <AlertDescription>
          A refund is on its way to your saved card. Most banks show it within
          5–10 business days.{" "}
          <Link href="/dashboard/orders">View your orders</Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="lg" variant="destructive" onClick={onCancel} loading={isPending}>
        {isPending ? "Cancelling…" : "Cancel and refund"}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] leading-[18px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
