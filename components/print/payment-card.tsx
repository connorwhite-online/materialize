"use client";

import { cn } from "@/lib/utils";
import {
  PaymentCardFallback,
  paymentCardAriaLabel,
  type PaymentCardProps,
} from "./payment-card-fallback";

/**
 * Materialize payment card on the service-fee sheet.
 *
 * CSS only. A WebGL twin was tried (thin plate, then thicker
 * extruded mark) and kept losing to this face on real devices —
 * flatter titanium read, no context-lost flash, no three.js on the
 * checkout path. Keep the flat plate.
 *
 * Entrance (soft fade / lift / scale) lives on `.mz-pay-card-enter`
 * in globals.css.
 */

export type { PaymentCardProps };

export function PaymentCard({
  className,
  ...props
}: PaymentCardProps & { className?: string }) {
  return (
    <div
      className={cn(
        "mz-pay-card-enter relative mx-auto w-full max-w-[22rem]",
        className
      )}
      role="img"
      aria-label={paymentCardAriaLabel(props)}
    >
      <div
        className="relative aspect-[1.586] w-full"
        data-testid="payment-card-fallback"
      >
        <PaymentCardFallback {...props} />
      </div>
    </div>
  );
}
