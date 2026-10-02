import type * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Receipt-style label/value list used by the order confirm, cancel and
 * pay-production pages. Each page used to carry its own copy of `Row`
 * and `fmt` inside a hand-rolled bordered div.
 */
export function SummaryCard({
  title,
  className,
  children,
}: {
  title?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-0 px-5 py-4", className)}>
      {title && (
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
      )}
      <dl className="flex flex-col gap-2.5 text-sm">{children}</dl>
    </Card>
  );
}

export function SummaryRow({
  label,
  value,
  total = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** The bottom line: separated by a hairline, set in the heavier weight. */
  total?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        total && "mt-1.5 border-t border-dashed border-border pt-3.5"
      )}
    >
      <dt className={total ? "font-medium" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-right tabular-nums",
          total && "text-base font-semibold"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
