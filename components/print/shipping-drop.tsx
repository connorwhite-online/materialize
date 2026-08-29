"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { cn } from "@/lib/utils";
import {
  ShippingDropFallback,
  shippingDropAriaLabel,
} from "./shipping-drop-fallback";

/**
 * Little 3D cardboard box with a parachute — the sheet hero for
 * shipping options, mirroring PaymentCard: WebGL scene over a
 * permanent CSS fallback, shared enter animation.
 *
 * The canvas layer stays painted (not faded out until ready).
 * Hiding WebGL until the first frame can skip that frame on some
 * GPUs and leave only the SVG underlay — which reads as "not a
 * 3D model." Fallback stays underneath for a lost context.
 *
 * `next/dynamic` with `ssr: false` keeps three.js / R3F off the
 * print-checkout critical path (see
 * node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
 *
 * Entrance reuses `.mz-pay-card-enter` so the settle matches the
 * fee-sheet card (soft fade / lift / scale after the sheet leads).
 */

const ShippingDropScene = dynamic(
  () => import("./shipping-drop-scene").then((m) => m.ShippingDropScene),
  { ssr: false, loading: () => null }
);

export function ShippingDrop({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);

  return (
    <div
      className={cn(
        "mz-pay-card-enter relative mx-auto w-full max-w-[14rem]",
        className
      )}
      role="img"
      aria-label={shippingDropAriaLabel()}
    >
      <div className="relative aspect-square w-full">
        {/* Permanent underlay — never unmount. */}
        <div className="absolute inset-0" data-testid="shipping-drop-fallback">
          <ShippingDropFallback />
        </div>
        <ErrorBoundary fallback={null}>
          <div
            className={failed ? "hidden" : "absolute inset-0"}
            data-testid="shipping-drop-webgl"
            aria-hidden
          >
            <ShippingDropScene onFail={onFail} />
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
