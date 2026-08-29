"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { cn } from "@/lib/utils";
import {
  AddressHomeFallback,
  addressHomeAriaLabel,
} from "./address-home-fallback";

/**
 * Little 3D cartoon house for the address step of the checkout
 * sheet — same architecture as PaymentCard / ShippingDrop:
 * permanent CSS fallback under a lazy WebGL scene, shared enter
 * animation via `.mz-pay-card-enter`.
 *
 * The canvas layer stays painted (not faded out until ready).
 * Hiding WebGL until the first frame can skip that frame on some
 * GPUs and leave only the SVG underlay — which reads as "not a
 * 3D model." Fallback stays underneath for a lost context.
 *
 * `next/dynamic` with `ssr: false` keeps three.js off the print
 * critical path (see
 * node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
 */

const AddressHomeScene = dynamic(
  () => import("./address-home-scene").then((m) => m.AddressHomeScene),
  { ssr: false, loading: () => null }
);

export function AddressHome({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);

  return (
    <div
      className={cn(
        "mz-pay-card-enter relative mx-auto w-full max-w-[13rem]",
        className
      )}
      role="img"
      aria-label={addressHomeAriaLabel()}
    >
      <div className="relative aspect-square w-full">
        {/* Permanent underlay — never unmount. */}
        <div className="absolute inset-0" data-testid="address-home-fallback">
          <AddressHomeFallback />
        </div>
        <ErrorBoundary fallback={null}>
          <div
            className={failed ? "hidden" : "absolute inset-0"}
            data-testid="address-home-webgl"
            aria-hidden
          >
            <AddressHomeScene onFail={onFail} />
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
