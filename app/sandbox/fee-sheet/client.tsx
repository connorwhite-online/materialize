"use client";

import { SavedCardFeeSheet } from "@/components/print/fee-payment-sheet";

/**
 * Fixture matching the live saved-card confirm sheet (Mastercard
 * •••• 4444, $0.99 fee) so the 3D Materialize card can be reviewed
 * without walking a full two_step checkout.
 */
export function FeeSheetSandbox() {
  return (
    <div className="min-h-svh bg-background">
      <SavedCardFeeSheet
        confirm={{
          orderId: "sandbox-order",
          amountCents: 99,
          brand: "mastercard",
          last4: "4444",
        }}
        // Resolve with an error so the sheet unlocks — live parents
        // navigate away on success and leave the phase locked.
        onAuthorize={async () => {
          await new Promise((r) => setTimeout(r, 500));
          return { error: "Sandbox only — nothing was charged." };
        }}
        onUseDifferentCard={async () => {
          await new Promise((r) => setTimeout(r, 400));
          return { error: "Sandbox only — no card form here." };
        }}
        onClose={() => {}}
      />
    </div>
  );
}
