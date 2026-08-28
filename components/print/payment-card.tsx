"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { cn } from "@/lib/utils";
import {
  PaymentCardFallback,
  paymentCardAriaLabel,
  type PaymentCardProps,
} from "./payment-card-fallback";

/**
 * Little 3D Materialize payment card.
 *
 * The scene pulls in three.js / R3F / studio IBL — the same chunk
 * family as the dropzone primitives. `next/dynamic` with `ssr: false`
 * keeps that off the print-checkout critical path (see
 * node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md —
 * `ssr: false` is only legal in a Client Component).
 *
 * The CSS fallback is the first paint and the stand-in whenever WebGL
 * isn't available (context lost, no GPU, ErrorBoundary). We only hide
 * it after the canvas reports a live, non-lost context — otherwise a
 * SwiftShader context-lost leaves a blank hole in the fee sheet.
 *
 * Entrance (soft fade / lift / scale) lives on `.mz-pay-card-enter`
 * in globals.css so both the fallback and the canvas share one motion.
 */

const PaymentCardScene = dynamic(
  () => import("./payment-card-scene").then((m) => m.PaymentCardScene),
  { ssr: false, loading: () => null }
);

export type { PaymentCardProps };

export function PaymentCard({
  className,
  ...props
}: PaymentCardProps & { className?: string }) {
  const [live, setLive] = useState(false);
  const onReady = useCallback(() => setLive(true), []);
  const onFail = useCallback(() => setLive(false), []);

  return (
    <div
      className={cn(
        "mz-pay-card-enter relative mx-auto w-full max-w-[22rem]",
        className
      )}
      role="img"
      aria-label={paymentCardAriaLabel(props)}
    >
      <div className="relative aspect-[1.586] w-full">
        {!live && (
          <div className="absolute inset-0">
            <PaymentCardFallback {...props} />
          </div>
        )}
        <ErrorBoundary
          fallback={
            <div className="absolute inset-0">
              <PaymentCardFallback {...props} />
            </div>
          }
        >
          <div
            className={
              live
                ? "absolute inset-0"
                : "pointer-events-none absolute inset-0 opacity-0"
            }
          >
            <PaymentCardScene
              {...props}
              onReady={onReady}
              onFail={onFail}
            />
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
