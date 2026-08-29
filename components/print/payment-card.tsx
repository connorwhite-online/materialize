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
 * CSS only. A WebGL / R3F twin used to mount underneath (and briefly
 * over) this face — extruded mark, clearcoat RoundedBox, studio IBL.
 * On a real phone that twin looked bubbly and different from this
 * flat titanium plate, and the pending→live handoff flashed both
 * models. The flat face is the one that reads correctly; keep it.
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
