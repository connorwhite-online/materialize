"use client";

import { useCallback, useEffect, useState } from "react";
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
 * Surface state machine (exactly one model on screen):
 *   pending  → empty aspect box while the canvas chunk loads
 *   live     → WebGL only
 *   fallback → CSS only (timeout, context lost, or ErrorBoundary)
 *
 * Showing the CSS face during `pending` was the dual-model flash:
 * titanium CSS plate, then a darker tilted WebGL card swapping in.
 * We never crossfade the two — the winner paints alone, and the
 * enter animation only runs once that winner is chosen.
 */

const PaymentCardScene = dynamic(
  () => import("./payment-card-scene").then((m) => m.PaymentCardScene),
  { ssr: false, loading: () => null }
);

/** How long we wait for a painted WebGL frame before committing to CSS. */
export const WEBGL_FALLBACK_MS = 1800;

type CardSurface = "pending" | "live" | "fallback";

export type { PaymentCardProps };

/** ErrorBoundary fallback — flips the parent into CSS mode. */
function FailSignal({ onFail }: { onFail: () => void }) {
  useEffect(() => {
    onFail();
  }, [onFail]);
  return null;
}

export function PaymentCard({
  className,
  ...props
}: PaymentCardProps & { className?: string }) {
  const [surface, setSurface] = useState<CardSurface>("pending");
  const onReady = useCallback(() => {
    setSurface((s) => (s === "fallback" ? s : "live"));
  }, []);
  const onFail = useCallback(() => setSurface("fallback"), []);

  useEffect(() => {
    if (surface !== "pending") return;
    const id = window.setTimeout(() => setSurface("fallback"), WEBGL_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [surface]);

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[22rem]",
        // Enter only after a surface wins — animating the empty slot
        // then swapping models mid-flight was part of the flash.
        surface !== "pending" && "mz-pay-card-enter",
        className
      )}
      role="img"
      aria-label={paymentCardAriaLabel(props)}
      data-surface={surface}
    >
      <div className="relative aspect-[1.586] w-full">
        {surface === "fallback" ? (
          <div className="absolute inset-0" data-testid="payment-card-fallback">
            <PaymentCardFallback {...props} />
          </div>
        ) : null}
        {surface !== "fallback" ? (
          <ErrorBoundary fallback={<FailSignal onFail={onFail} />}>
            <div
              className={
                surface === "live"
                  ? "absolute inset-0"
                  : "pointer-events-none absolute inset-0 opacity-0"
              }
              aria-hidden={surface !== "live"}
            >
              <PaymentCardScene
                {...props}
                onReady={onReady}
                onFail={onFail}
              />
            </div>
          </ErrorBoundary>
        ) : null}
      </div>
    </div>
  );
}
