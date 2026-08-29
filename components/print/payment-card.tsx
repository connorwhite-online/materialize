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
 * The CSS fallback stays mounted under the canvas for the whole
 * life of the component — unmounting it on ready was the blank-hole
 * bug (SwiftShader reports ready, then loses the context). While
 * WebGL is live we only *hide* the underlay (opacity-0); otherwise
 * the tilted 3D card and the flat CSS face both show through the
 * transparent canvas and read as a duplicated stack. On context
 * lost / ErrorBoundary we flip `live` off and the underlay is
 * visible again with no remount flash.
 *
 * Entrance (soft fade / lift / scale) lives on `.mz-pay-card-enter`
 * in globals.css so both layers share one motion.
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
        {/* Mounted always; visually hidden while the canvas is live. */}
        <div
          className={
            live
              ? "pointer-events-none absolute inset-0 opacity-0"
              : "absolute inset-0"
          }
          data-testid="payment-card-fallback"
          aria-hidden={live}
        >
          <PaymentCardFallback {...props} />
        </div>
        <ErrorBoundary fallback={null}>
          <div
            className={
              live
                ? "absolute inset-0"
                : "pointer-events-none absolute inset-0 opacity-0"
            }
            aria-hidden={!live}
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
