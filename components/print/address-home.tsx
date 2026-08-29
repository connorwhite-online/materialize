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
 * `next/dynamic` with `ssr: false` keeps three.js off the print
 * critical path (see
 * node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md).
 */

const AddressHomeScene = dynamic(
  () => import("./address-home-scene").then((m) => m.AddressHomeScene),
  { ssr: false, loading: () => null }
);

export function AddressHome({ className }: { className?: string }) {
  const [live, setLive] = useState(false);
  const onReady = useCallback(() => setLive(true), []);
  const onFail = useCallback(() => setLive(false), []);

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
            className={
              live
                ? "absolute inset-0"
                : "pointer-events-none absolute inset-0 opacity-0"
            }
            aria-hidden={!live}
          >
            <AddressHomeScene onReady={onReady} onFail={onFail} />
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
