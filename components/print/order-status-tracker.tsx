"use client";

const STEPS = [
  { key: "ordered", label: "Ordered" },
  { key: "in_production", label: "In Production" },
  { key: "shipped", label: "Shipped" },
  { key: "received", label: "Received" },
] as const;

interface OrderStatusTrackerProps {
  currentStatus: string;
  trackingInfo?: {
    trackingUrl?: string;
    trackingNumber?: string;
    carrier?: string;
  } | null;
}

export function OrderStatusTracker({
  currentStatus,
  trackingInfo,
}: OrderStatusTrackerProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);
  const isCancelled = currentStatus === "cancelled";

  return (
    <div>
      {isCancelled ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="font-medium text-red-600">Order Cancelled</p>
        </div>
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
                    isCompleted ? "font-medium" : "text-foreground/40"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {trackingInfo?.trackingNumber && (
        <div className="mt-4 rounded-md bg-foreground/5 p-3 text-sm">
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
        </div>
      )}
    </div>
  );
}
