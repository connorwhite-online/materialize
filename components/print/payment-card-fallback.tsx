"use client";

import { useId } from "react";
import { Logomark } from "@/components/brand/logo";

/**
 * CSS stand-in for the WebGL payment card — lazy-load placeholder
 * and ErrorBoundary fallback so a missing WebGL context still shows
 * the same composition: Materialize mark top-left, metal chip
 * top-right. The 3D scene paints over this once the canvas is ready.
 */

export interface PaymentCardProps {
  /** Service-fee amount, in cents. Shown on the card face. */
  amountCents?: number;
  /** Card brand ("visa", "mastercard", …) or PM type ("link"). */
  brand?: string;
  /** Last four digits; null for non-card methods (Link). */
  last4?: string | null;
  /** Saved-card confirm / billing: marks the method as on file. */
  saved?: boolean;
}

export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function cardBrandLabel(brand?: string): string | undefined {
  if (!brand) return undefined;
  if (brand === "link") return "Link";
  if (brand === "amex") return "Amex";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function paymentCardAriaLabel({
  amountCents,
  brand,
  last4,
  saved,
}: PaymentCardProps): string {
  const parts = ["Materialize card"];
  if (amountCents != null) {
    parts.push(`service fee ${formatUsdCents(amountCents)}`);
  }
  if (last4) {
    parts.push(`${cardBrandLabel(brand) ?? "Card"} ending ${last4}`);
  } else if (brand) {
    const label = cardBrandLabel(brand);
    if (label) parts.push(label);
  }
  if (saved) parts.push("saved");
  return parts.join(", ");
}

export function PaymentCardFallback({
  amountCents,
  brand,
  last4,
  saved,
}: PaymentCardProps) {
  const brandLabel = cardBrandLabel(brand);
  const amount = amountCents != null ? formatUsdCents(amountCents) : null;

  return (
    <div aria-hidden="true" className="mz-pay-card">
      <div className="mz-pay-card-face">
        <div className="mz-pay-card-top">
          <span className="mz-pay-card-logo text-white">
            <Logomark height={18} />
          </span>
          <EmvChipMark />
        </div>
        <div className="mz-pay-card-body">
          {amount ? (
            <>
              <p className="mz-pay-card-kicker">Service fee</p>
              <p className="mz-pay-card-amount">{amount}</p>
            </>
          ) : (
            <p className="mz-pay-card-kicker">Materialize</p>
          )}
        </div>
        <div className="mz-pay-card-bottom">
          <span className="mz-pay-card-name">Materialize</span>
          <span className="mz-pay-card-pan">
            {last4
              ? `${brandLabel ? `${brandLabel} ` : ""}•••• ${last4}`
              : brandLabel ?? (saved ? "Saved" : "")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** ISO 7816-style contact plate — gold metal with six pads + a center bar. */
export function EmvChipMark() {
  const uid = useId();
  const gold = `${uid}-gold`;
  return (
    <svg
      viewBox="0 0 48 36"
      width="40"
      height="30"
      aria-hidden="true"
      data-testid="payment-card-chip"
      className="mz-pay-card-chip"
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0d78c" />
          <stop offset="0.45" stopColor="#c9a227" />
          <stop offset="1" stopColor="#8a6a12" />
        </linearGradient>
      </defs>
      <rect
        x="0.6"
        y="0.6"
        width="46.8"
        height="34.8"
        rx="6"
        fill={`url(#${gold})`}
        stroke="#6b5410"
        strokeOpacity="0.45"
        strokeWidth="1.2"
      />
      {/* Two columns of three pads, plus the center interconnect. */}
      <g fill="#6e5610" fillOpacity="0.55">
        <rect x="6" y="5.5" width="14" height="6.2" rx="1.1" />
        <rect x="6" y="14.9" width="14" height="6.2" rx="1.1" />
        <rect x="6" y="24.3" width="14" height="6.2" rx="1.1" />
        <rect x="28" y="5.5" width="14" height="6.2" rx="1.1" />
        <rect x="28" y="14.9" width="14" height="6.2" rx="1.1" />
        <rect x="28" y="24.3" width="14" height="6.2" rx="1.1" />
        <rect x="18.5" y="11.2" width="11" height="13.6" rx="1" />
      </g>
    </svg>
  );
}
