"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { requestOrderRefund } from "@/app/actions/print";

const STEPS = [
  { key: "ordered", label: "Confirmed" },
  { key: "in_production", label: "In Production" },
  { key: "shipped", label: "Shipped" },
  { key: "received", label: "Delivered" },
] as const;

interface OrderStatusTrackerProps {
  orderId: string;
  currentStatus: string;
  trackingInfo?: {
    trackingUrl?: string;
    trackingNumber?: string;
    carrier?: string;
  } | null;
}

export function OrderStatusTracker({
  orderId,
  currentStatus,
  trackingInfo,
}: OrderStatusTrackerProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);
  const isBlocked = currentStatus === "blocked";
  const isCancelled = currentStatus === "cancelled";
  const isRefunded = currentStatus === "refunded";
  const isTerminal = isCancelled || isRefunded;

  return (
    <div>
      {isBlocked ? (
        <BlockedOrderCard orderId={orderId} />
      ) : isRefunded ? (
        <Alert className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <p className="text-sm font-medium">Order Refunded</p>
          <p className="text-xs mt-1">
            A full refund has been issued to your original payment method. It may take 5-10 business days to appear.
          </p>
        </Alert>
      ) : isCancelled ? (
        <Alert variant="destructive">
          <p className="text-sm font-medium">Order Cancelled</p>
        </Alert>
      ) : (
        <div className="flex items-center gap-2">
          {STEPS.map((step, index) => {
            const isCompleted = index <= currentIndex;
            const isCurrent = index === currentIndex;

            return (
              <div key={step.key} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  {index > 0 && (
                    <div
                      className={`h-0.5 flex-1 ${
                        isCompleted ? "bg-foreground" : "bg-foreground/20"
                      }`}
                    />
                  )}
                  <div
                    className={`h-3 w-3 rounded-full ${
                      isCurrent
                        ? "bg-foreground ring-2 ring-foreground/20 ring-offset-2 ring-offset-background"
                        : isCompleted
                          ? "bg-foreground"
                          : "bg-foreground/20"
                    }`}
                  />
                  {index < STEPS.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 ${
                        index < currentIndex
                          ? "bg-foreground"
                          : "bg-foreground/20"
                      }`}
                    />
                  )}
                </div>
                <span
                  className={`mt-2 text-xs ${
                    isCompleted ? "font-medium" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {trackingInfo?.trackingNumber && !isTerminal && (
        <Card className="mt-4">
          <CardContent className="p-3 text-sm">
            <p>
              Tracking: {trackingInfo.carrier && `${trackingInfo.carrier} — `}
              {trackingInfo.trackingUrl ? (
                <a
                  href={trackingInfo.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {trackingInfo.trackingNumber}
                </a>
              ) : (
                <span>{trackingInfo.trackingNumber}</span>
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BlockedOrderCard({ orderId }: { orderId: string }) {
  const [refunding, setRefunding] = useState(false);
  const [refundResult, setRefundResult] = useState<string | null>(null);

  const handleRefund = async () => {
    setRefunding(true);
    const result = await requestOrderRefund(orderId);
    if ("error" in result) {
      setRefundResult(result.error);
    } else {
      setRefundResult("Refund issued successfully.");
    }
    setRefunding(false);
  };

  return (
    <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Print Rejected by Manufacturer
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          The manufacturing facility identified a geometry issue with your model
          that prevents it from being printed. This can happen with thin walls,
          non-watertight meshes, or features too small for the chosen material.
        </p>

        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
            Your options:
          </p>
          <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
            <li>Fix the model geometry and resubmit with a new print order</li>
            <li>Try a different material that may support your geometry</li>
            <li>Request a full refund below</li>
          </ul>
        </div>

        {refundResult ? (
          <p className="mt-3 text-xs font-medium text-amber-800 dark:text-amber-200">
            {refundResult}
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefund}
            disabled={refunding}
            className="mt-3"
          >
            {refunding ? "Processing refund..." : "Request Full Refund"}
          </Button>
        )}
      </div>
    </Alert>
  );
}
