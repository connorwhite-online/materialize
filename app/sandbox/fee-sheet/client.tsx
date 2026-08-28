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
        onAuthorize={async () => {}}
        onUseDifferentCard={async () => {}}
        onClose={() => {}}
      />
    </div>
  );
}
