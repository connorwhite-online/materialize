"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { cn } from "@/lib/utils";
import {
  PaymentCardFallback,
  paymentCardAriaLabel,
  type PaymentCardProps,
} from "./payment-card-fallback";

/**
 * Materialize payment card on the service-fee sheet.
 *
 * Prefers a thin WebGL plate (see payment-card-scene) — ISO-thin,
 * modest corners, flat mark decal. CSS is the failure path only
 * (timeout / context lost / software GL / ErrorBoundary).
 *
 * Critical: never promote to `live` on the first painted frame.
 * SwiftShader paints one frame, onReady used to flip the canvas
 * visible, then the context died and CSS snapped in — that was the
 * "old card flashing" bug in the demos. ReadySignal waits
 * WEBGL_STABLE_MS; software renderers fail in onCreated; `failedRef`
 * makes a late onReady a no-op if onFail already won the race.
 *
 * Surface: pending → empty slot → live (WebGL) | fallback (CSS).
 * Enter animation runs only after a winner is chosen.
 */

const PaymentCardScene = dynamic(
  () => import("./payment-card-scene").then((m) => m.PaymentCardScene),
  { ssr: false, loading: () => null }
);

/** How long we wait for a painted WebGL frame before committing to CSS. */
export const WEBGL_FALLBACK_MS = 1800;

type CardSurface = "pending" | "live" | "fallback";

export type { PaymentCardProps };

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
  const failedRef = useRef(false);
  const onReady = useCallback(() => {
    if (failedRef.current) return;
    setSurface((s) => (s === "fallback" ? s : "live"));
  }, []);
  const onFail = useCallback(() => {
    failedRef.current = true;
    setSurface("fallback");
  }, []);

  useEffect(() => {
    if (surface !== "pending") return;
    const id = window.setTimeout(() => {
      failedRef.current = true;
      setSurface("fallback");
    }, WEBGL_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [surface]);

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[22rem]",
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
