"use client";

import { useEffect, useState } from "react";
import { SandboxProvider } from "@/components/sandbox-context";
import {
  ShippingSheet,
  type CheckoutSheetStep,
} from "@/components/print/shipping-sheet";
import type { ShippingOption } from "@/components/print/shipping-options";

const QUOTE = {
  quoteId: "sandbox-q1",
  vendorId: "vendor-1",
  vendorName: "PrintLab EU",
  price: 24.5,
  currency: "USD",
};

const SHIPPING: ShippingOption[] = [
  {
    shippingId: "std",
    vendorId: "vendor-1",
    name: "Standard",
    deliveryTime: 7,
    price: 6.25,
    type: "standard",
  },
  {
    shippingId: "exp",
    vendorId: "vendor-1",
    name: "Express",
    deliveryTime: 2,
    price: 18.5,
    type: "express",
  },
];

/**
 * Fixture for the vendor checkout sheet without decorative 3D heroes.
 */
export function CheckoutSheetSandbox() {
  const [step, setStep] = useState<CheckoutSheetStep>("shipping");
  const [open, setOpen] = useState(false);
  const [selectedShipping, setSelectedShipping] = useState<ShippingOption>(
    SHIPPING[0]
  );

  useEffect(() => {
    setOpen(true);
  }, []);

  return (
    <SandboxProvider sandbox>
      <div className="min-h-svh bg-background px-6 py-8">
        <p className="text-sm text-muted-foreground">
          Sandbox — vendor checkout sheet
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              setStep("shipping");
              setOpen(true);
            }}
          >
            Show shipping
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              setStep("address");
              setOpen(true);
            }}
          >
            Show address
          </button>
        </div>
        <ShippingSheet
          open={open}
          step={step}
          onStepChange={setStep}
          quote={QUOTE}
          shipping={SHIPPING}
          selectedShipping={selectedShipping}
          onSelectShipping={setSelectedShipping}
          quantity={1}
          onCheckout={() => setStep("address")}
          isCheckingOut={false}
          onAddToCart={() => {}}
          isAddingToCart={false}
          onAddressSubmit={() => {}}
          isSubmittingAddress={false}
          anonMode
          onDismiss={() => setOpen(false)}
        />
      </div>
    </SandboxProvider>
  );
}
