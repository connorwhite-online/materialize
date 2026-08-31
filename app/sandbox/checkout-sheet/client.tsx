"use client";

import { useEffect, useState } from "react";
import { SandboxProvider } from "@/components/sandbox-context";
import {
  ShippingSheet,
  type CheckoutSheetStep,
} from "@/components/print/shipping-sheet";
import type { SavedCheckoutAddress } from "@/components/print/shipping-address-form";
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

const SAVED_ADDRESS: SavedCheckoutAddress = {
  email: "connorwhitepdx@gmail.com",
  shipping: {
    firstName: "Connor",
    lastName: "White",
    address: "3711 Glenfeliz Blvd.",
    city: "Los Angeles",
    stateCode: "CA",
    zipCode: "90039",
    countryCode: "US",
  },
  billing: {
    firstName: "Connor",
    lastName: "White",
    address: "3711 Glenfeliz Blvd.",
    city: "Los Angeles",
    stateCode: "CA",
    zipCode: "90039",
    countryCode: "US",
    isCompany: false,
  },
};

type AddressMode = "anon" | "saved";

/**
 * Fixture for the vendor checkout sheet without decorative 3D heroes.
 */
export function CheckoutSheetSandbox() {
  const [step, setStep] = useState<CheckoutSheetStep>("shipping");
  const [open, setOpen] = useState(false);
  const [addressMode, setAddressMode] = useState<AddressMode>("anon");
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
              setAddressMode("anon");
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
              setAddressMode("anon");
              setStep("address");
              setOpen(true);
            }}
          >
            Show address
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              setAddressMode("saved");
              setStep("address");
              setOpen(true);
            }}
          >
            Show saved address
          </button>
        </div>
        <ShippingSheet
          // Remount when address mode flips so the form's mount-time
          // stage (saved vs form) re-evaluates against the new props.
          key={addressMode}
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
          anonMode={addressMode === "anon"}
          savedAddress={addressMode === "saved" ? SAVED_ADDRESS : null}
          onDismiss={() => setOpen(false)}
        />
      </div>
    </SandboxProvider>
  );
}
