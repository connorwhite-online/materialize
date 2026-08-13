// @vitest-environment jsdom
/**
 * The sandbox chip used to live in the nav on every page. It now shows
 * up only where money is about to move — this pins it to the order
 * summary, and pins the default (no provider) to "live", so a real
 * customer can never be told they're in a sandbox by accident.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SandboxProvider } from "@/components/sandbox-context";
import { PriceDisplay } from "../price-display";

const QUOTE = {
  quoteId: "q1",
  vendorId: "v1",
  materialConfigId: "m1",
  price: 24.5,
  currency: "USD",
};

const SHIPPING = {
  shippingId: "s1",
  vendorId: "v1",
  name: "Standard",
  deliveryTime: 7,
  price: 6.25,
  type: "standard" as const,
};

function renderSummary() {
  return (
    <PriceDisplay
      selectedQuote={QUOTE}
      shipping={[SHIPPING]}
      selectedShipping={SHIPPING}
      onSelectShipping={() => {}}
      quantity={1}
      onCheckout={() => {}}
      isCheckingOut={false}
    />
  );
}

const chip = () =>
  screen.queryByLabelText(
    "Sandbox mode — orders will not be billed or fulfilled"
  );

describe("PriceDisplay sandbox chip", () => {
  it("flags the order summary when the deployment is in sandbox mode", () => {
    render(<SandboxProvider sandbox>{renderSummary()}</SandboxProvider>);
    expect(chip()).toBeTruthy();
    expect(screen.getByText("Order Summary")).toBeTruthy();
  });

  it("stays out of the way on a live deployment", () => {
    render(
      <SandboxProvider sandbox={false}>{renderSummary()}</SandboxProvider>
    );
    expect(chip()).toBeNull();
  });

  it("defaults to live with no provider above it", () => {
    render(renderSummary());
    expect(chip()).toBeNull();
  });
});
