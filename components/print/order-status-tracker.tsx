"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestOrderRefund } from "@/app/actions/print";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    key: "ordered",
    label: "Confirmed",
    detail: "The print shop has your order and will start on it soon.",
  },
  {
    key: "in_production",
    label: "In production",
    detail: "Your part is being made.",
  },
  {
    key: "shipped",
    label: "Shipped",
    detail: "Your print is on its way.",
  },
  {
    key: "received",
    label: "Delivered",
    detail: "Your print has been delivered.",
  },
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

  const current = currentIndex >= 0 ? STEPS[currentIndex] : null;

  return (
    <div className="flex flex-col gap-4">
      {isBlocked ? (
        <BlockedOrderCard orderId={orderId} />
      ) : isRefunded ? (
        <TerminalState title="Order refunded">
          A full refund went back to your original payment method. It can
          take 5–10 business days to appear.
        </TerminalState>
      ) : isCancelled ? (
        <TerminalState title="Order cancelled">
          This order won&apos;t be made or shipped.
        </TerminalState>
      ) : (
        <div>
          <ol className="grid grid-cols-4" aria-label="Order progress">
            {STEPS.map((step, index) => {
              const done = index < currentIndex;
              const isCurrent = index === currentIndex;
              const reached = index <= currentIndex;
              return (
                <li
                  key={step.key}
                  aria-current={isCurrent ? "step" : undefined}
                  className="relative flex flex-col items-center text-center"
                >
                  {/* Connector to the previous step, drawn behind the dot. */}
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-2.5 right-1/2 h-0.5 w-full -translate-y-1/2",
                        reached ? "bg-foreground" : "bg-border"
                      )}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative flex size-5 items-center justify-center rounded-full",
                      done && "bg-foreground text-background",
                      isCurrent &&
                        "bg-foreground ring-4 ring-foreground/10",
                      !reached && "bg-background ring-2 ring-border ring-inset"
                    )}
                  >
                    {done && <CheckIcon className="size-3" strokeWidth={3} />}
                    {isCurrent && (
                      <span className="size-1.5 rounded-full bg-background" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "mt-2 text-[13px] leading-[18px]",
                      reached ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {current && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {current.detail}
            </p>
          )}
        </div>
      )}

      {trackingInfo?.trackingNumber && !isTerminal && (
        <p className="text-sm">
          <span className="text-muted-foreground">
            Tracking{trackingInfo.carrier ? ` · ${trackingInfo.carrier}` : ""}:{" "}
          </span>
          {trackingInfo.trackingUrl ? (
            <a
              href={trackingInfo.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-3"
            >
              {trackingInfo.trackingNumber}
            </a>
          ) : (
            <span className="font-medium">{trackingInfo.trackingNumber}</span>
          )}
        </p>
      )}

      {/* Cancel option — only for orders not yet in production */}
      {currentStatus === "ordered" && <CancelOrderOption orderId={orderId} />}

      {/* In production or shipped — contact support for changes */}
      {(currentStatus === "in_production" || currentStatus === "shipped") && (
        <p className="text-center text-[13px] leading-[18px] text-subtle-foreground">
          Need a change? Contact support — your order is already being made.
        </p>
      )}
    </div>
  );
}

function CancelOrderOption({ orderId }: { orderId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleCancel = async () => {
    setProcessing(true);
    const res = await requestOrderRefund(orderId);
    if ("error" in res) {
      setResult(res.error);
    } else {
      setResult("Order cancelled and refund issued.");
    }
    setProcessing(false);
    setConfirming(false);
  };

  if (result) {
    return (
      <p role="status" className="text-center text-sm text-muted-foreground">
        {result}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-center text-muted-foreground"
        onClick={() => setConfirming(true)}
      >
        Cancel order
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <p className="text-sm text-muted-foreground">
        Cancel and get a full refund?
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirming(false)}
        disabled={processing}
      >
        Keep order
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={handleCancel}
        loading={processing}
      >
        Cancel and refund
      </Button>
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
      setRefundResult("Refund issued.");
    }
    setRefunding(false);
  };

  return (
    <TerminalState title="Order could not be completed" tone="warning">
      <p>
        The print shop couldn&apos;t make this order — the geometry may not
        suit the material, stock or capacity ran short, or the file needs
        adjusting. Try another material or shop, or get a full refund.
      </p>
      {refundResult ? (
        <p role="status" className="mt-3 font-medium text-foreground">
          {refundResult}
        </p>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefund}
          loading={refunding}
          className="mt-3"
        >
          Request a full refund
        </Button>
      )}
    </TerminalState>
  );
}

/**
 * An order that left the happy path (blocked / cancelled / refunded):
 * a status line and what it means, in place of the stepper. Unboxed —
 * it sits inside the page's Status card.
 */
function TerminalState({
  title,
  tone = "neutral",
  children,
}: {
  title: string;
  tone?: "neutral" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          tone === "warning" ? "bg-warning" : "bg-subtle-foreground"
        )}
      />
      <div className="min-w-0">
        <p className="text-sm leading-5 font-medium">{title}</p>
        <div className="mt-0.5 text-sm text-pretty text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}
