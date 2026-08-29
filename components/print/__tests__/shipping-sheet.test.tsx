// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { ShippingOption } from "../shipping-options";

vi.mock("@/components/ui/native-sheet", () => ({
  NativeSheet: ({
    open,
    onClose,
    children,
    ariaLabel,
  }: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    ariaLabel: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={ariaLabel}>
        <button type="button" onClick={onClose}>
          close sheet
        </button>
        {children}
      </div>
    ) : null,
}));

vi.mock("../shipping-drop", () => ({
  ShippingDrop: () => <div data-testid="shipping-drop-hero" />,
}));

vi.mock("../address-home", () => ({
  AddressHome: () => <div data-testid="address-home-hero" />,
}));

vi.mock("../shipping-address-form", () => ({
  ShippingAddressForm: ({
    embedded,
    onBack,
  }: {
    embedded?: boolean;
    onBack: () => void;
  }) => (
    <div>
      <span>{embedded ? "embedded-address" : "card-address"}</span>
      <button type="button" onClick={onBack}>
        Change shipping
      </button>
    </div>
  ),
}));

import { ShippingSheet } from "../shipping-sheet";

const QUOTE = {
  quoteId: "q1",
  vendorId: "v1",
  vendorName: "Acme Prints",
  price: 12,
  currency: "USD",
};

const SHIPPING: ShippingOption[] = [
  {
    shippingId: "std",
    vendorId: "v1",
    name: "Standard",
    deliveryTime: 7,
    price: 6,
    type: "standard",
  },
  {
    shippingId: "exp",
    vendorId: "v1",
    name: "Express",
    deliveryTime: 2,
    price: 18,
    type: "express",
  },
];

const selected = SHIPPING[0];

function renderSheet(
  overrides: Partial<ComponentProps<typeof ShippingSheet>> = {}
) {
  const onDismiss = vi.fn();
  const onCheckout = vi.fn();
  const onStepChange = vi.fn();
  const onSelectShipping = vi.fn();
  const onAddressSubmit = vi.fn();
  const result = render(
    <ShippingSheet
      open
      step="shipping"
      onStepChange={onStepChange}
      quote={QUOTE}
      shipping={SHIPPING}
      selectedShipping={selected}
      onSelectShipping={onSelectShipping}
      quantity={1}
      onCheckout={onCheckout}
      isCheckingOut={false}
      onAddressSubmit={onAddressSubmit}
      isSubmittingAddress={false}
      onDismiss={onDismiss}
      {...overrides}
    />
  );
  return { ...result, onDismiss, onCheckout, onStepChange, onSelectShipping };
}

describe("ShippingSheet", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("opens on shipping with the parachute hero and vendor name", () => {
    renderSheet();
    expect(
      screen.getByRole("dialog", { name: "Choose shipping" })
    ).toBeTruthy();
    expect(screen.getByTestId("shipping-drop-hero")).toBeTruthy();
    expect(screen.getByText("Acme Prints")).toBeTruthy();
    expect(screen.getByText("Proceed to checkout")).toBeTruthy();
  });

  it("shows the cartoon house and embedded address form on the address step", () => {
    renderSheet({ step: "address" });
    expect(
      screen.getByRole("dialog", { name: "Shipping address" })
    ).toBeTruthy();
    expect(screen.getByTestId("address-home-hero")).toBeTruthy();
    expect(screen.getByText("embedded-address")).toBeTruthy();
    expect(screen.queryByTestId("shipping-drop-hero")).toBeNull();
  });

  it("Change shipping returns to the shipping step", () => {
    const { onStepChange } = renderSheet({ step: "address" });
    fireEvent.click(screen.getByText("Change shipping"));
    expect(onStepChange).toHaveBeenCalledWith("shipping");
  });

  it("dismiss after the exit animation cancels the pick", async () => {
    vi.useFakeTimers();
    const { onDismiss } = renderSheet();
    fireEvent.click(screen.getByText("close sheet"));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("locks dismiss while checkout is in flight", () => {
    const { onDismiss } = renderSheet({ isCheckingOut: true });
    fireEvent.click(screen.getByText("close sheet"));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
