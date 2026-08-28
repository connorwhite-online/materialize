"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/components/ui/error-boundary";
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
 * The CSS fallback is the first paint and the ErrorBoundary stand-in,
 * so a missing WebGL context still shows logo-left / chip-right.
 */

const PaymentCardScene = dynamic(
  () => import("./payment-card-scene").then((m) => m.PaymentCardScene),
  { ssr: false, loading: () => null }
);

export type { PaymentCardProps };

export function PaymentCard(props: PaymentCardProps) {
  const [live, setLive] = useState(false);

  return (
    <div
      className="relative mx-auto w-full max-w-[22rem]"
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
          <div className="absolute inset-0">
            <PaymentCardScene {...props} onCreated={() => setLive(true)} />
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
