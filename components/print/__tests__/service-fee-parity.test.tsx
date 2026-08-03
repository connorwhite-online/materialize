// @vitest-environment jsdom

/**
 * MTR-134: price-display.tsx, cart-panel.tsx, and cart-slot-stack.tsx
 * used to hardcode a local `SERVICE_FEE_RATE = 0.03` and compute
 * `base * 0.03` directly, ignoring the two_step $0.50 minimum clamp
 * that lib/fees.ts's calcServiceFee applies (and that the server
 * actually charges). These tests render each component at a
 * sub-$16.67 pre-shipping base — the exact band where a flat 3%
 * calculation diverges from the clamped two_step figure — and assert
 * the displayed "Service fee" line always equals calcServiceFee's
 * output for the given checkoutModel.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { calcServiceFee } from "@/lib/fees";

// Sub-$16.67 base used by every case below: 1000 cents ($10.00) of
// material. calcServiceFee(1000, "single") = 30 (flat 3%);
// calcServiceFee(1000, "two_step") = 50 (clamped — flat 3% would
// have been 30, which is what the old hardcoded math produced).
const BASE_CENTS = 1000;

describe("PriceDisplay — service fee matches calcServiceFee (MTR-134)", () => {
  it.each(["single", "two_step"] as const)(
    "checkoutModel=%s",
    async (checkoutModel) => {
      const { PriceDisplay } = await import("../price-display");
      const expectedFeeCents = calcServiceFee(BASE_CENTS, checkoutModel);

      render(
        <PriceDisplay
          selectedQuote={{
            quoteId: "q1",
            vendorId: "vendor-1",
            materialConfigId: "mat-1",
            price: 10, // dollars — materialCost = price * quantity = $10
            currency: "USD",
          }}
          shipping={[
            {
              shippingId: "ship-1",
              vendorId: "vendor-1",
              name: "Standard",
              deliveryTime: 5,
              price: 5,
              type: "standard",
            },
          ]}
          selectedShipping={{
            shippingId: "ship-1",
            vendorId: "vendor-1",
            name: "Standard",
            deliveryTime: 5,
            price: 5,
            type: "standard",
          }}
          onSelectShipping={() => {}}
          quantity={1}
          onCheckout={() => {}}
          isCheckingOut={false}
          checkoutModel={checkoutModel}
        />
      );

      const expectedDisplay = `$${(expectedFeeCents / 100).toFixed(2)}`;
      const feeRow = screen.getByText("Service fee (3%)").parentElement;
      expect(feeRow).not.toBeNull();
      expect(feeRow!.textContent).toContain(expectedDisplay);
    }
  );
});

// CartPanel and CartSlotStack both read from useCart() — mock it
// directly (same pattern as quote-configurator.test.tsx) rather than
// standing up a full CartProvider, since these tests only care about
// the fee arithmetic each renders from cart state.
const mockCartItem = {
  id: "item-1",
  fileAssetId: "asset-1",
  fileName: "Widget",
  originalFilename: "widget.stl",
  vendorId: "vendor-1",
  vendorName: "Vendor One",
  materialConfigId: "mat-1",
  shippingId: "ship-1",
  quoteId: "q1",
  quantity: 1,
  materialPrice: BASE_CENTS,
  shippingPrice: 500,
  currency: "USD",
  countryCode: "US",
  updatedAt: new Date().toISOString(),
};

function baseMockCart() {
  return {
    items: [mockCartItem],
    localItems: [],
    itemCount: 1,
    isOpen: true,
    loading: false,
    materializing: false,
    repricingIds: new Set<string>(),
    open: () => {},
    close: () => {},
    addItem: async () => ({ cartItemId: "item-1" }) as const,
    addLocalItem: () => ({ ok: true }) as const,
    removeItem: async () => {},
    removeLocalItem: () => {},
    updateQuantity: async () => ({ ok: true }) as const,
    updateLocalItemQuantity: () => {},
    materializeLocalItems: async () => ({ ok: true }),
    refresh: async () => {},
  };
}

describe("CartPanel — service fee matches calcServiceFee (MTR-134)", () => {
  it.each(["single", "two_step"] as const)(
    "checkoutModel=%s",
    async (checkoutModel) => {
      vi.resetModules();
      vi.doMock("../cart-context", () => ({
        useCart: () => baseMockCart(),
      }));
      vi.doMock("@clerk/nextjs", () => ({
        useUser: () => ({ isSignedIn: true }),
      }));
      vi.doMock("@/components/auth/auth-modal", () => ({
        useAuthModal: () => ({ openAuth: () => {} }),
      }));
      vi.doMock("next/navigation", () => ({
        useRouter: () => ({ push: () => {} }),
      }));

      const { CartPanel } = await import("../cart-panel");
      const expectedFeeCents = calcServiceFee(BASE_CENTS, checkoutModel);
      const expectedDisplay = `$${(expectedFeeCents / 100).toFixed(2)}`;

      render(<CartPanel checkoutModel={checkoutModel} />);

      const feeRow = screen.getByText("Service fee (3%)").parentElement;
      expect(feeRow).not.toBeNull();
      expect(feeRow!.textContent).toContain(expectedDisplay);
    }
  );
});

describe("CartSlotStack — service fee matches calcServiceFee (MTR-134)", () => {
  it.each(["single", "two_step"] as const)(
    "checkoutModel=%s",
    async (checkoutModel) => {
      vi.resetModules();
      vi.doMock("../cart-context", () => ({
        useCart: () => baseMockCart(),
      }));
      vi.doMock("@clerk/nextjs", () => ({
        useUser: () => ({ isSignedIn: true }),
      }));
      vi.doMock("@/components/auth/auth-modal", () => ({
        useAuthModal: () => ({ openAuth: () => {} }),
      }));
      vi.doMock("next/navigation", () => ({
        useRouter: () => ({ push: () => {} }),
      }));

      const { CartSlotStack } = await import("../cart-slot-stack");
      const expectedFeeCents = calcServiceFee(BASE_CENTS, checkoutModel);
      const expectedDisplay = `$${(expectedFeeCents / 100).toFixed(2)}`;

      render(
        <CartSlotStack
          expandedVendorId="vendor-1"
          checkoutModel={checkoutModel}
        />
      );

      const feeRow = screen.getByText("Service fee (3%)").parentElement;
      expect(feeRow).not.toBeNull();
      expect(feeRow!.textContent).toContain(expectedDisplay);
    }
  );
});
