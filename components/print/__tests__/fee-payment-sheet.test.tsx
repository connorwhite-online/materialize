// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/lib/stripe/browser", () => ({
  getStripeBrowser: () => Promise.resolve(null),
}));

vi.mock("@/app/actions/print", () => ({
  finalizeFeeAuthorization: vi.fn(),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  ExpressCheckoutElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));

vi.mock("../payment-card", () => ({
  PaymentCard: ({
    amountCents,
    brand,
    last4,
  }: {
    amountCents?: number;
    brand?: string;
    last4?: string | null;
  }) => (
    <div
      role="img"
      aria-label={[
        "Materialize card",
        amountCents != null ? `service fee $${(amountCents / 100).toFixed(2)}` : null,
        last4 ? `${brand ?? "card"} ending ${last4}` : null,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <span data-testid="payment-card-chip" />
    </div>
  ),
}));

import {
  FeePaymentSheet,
  SavedCardFeeSheet,
} from "../fee-payment-sheet";

beforeEach(() => {
  cleanup();
});

describe("FeePaymentSheet", () => {
  it("renders the Materialize card and the fee on the authorize button", () => {
    render(
      <FeePaymentSheet
        sheet={{
          clientSecret: "pi_test_secret",
          orderId: "order-1",
          amountCents: 99,
        }}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByRole("img", { name: /Materialize card, service fee \$0\.99/ })
    ).toBeTruthy();
    expect(screen.getByTestId("payment-card-chip")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Authorize \$0\.99/ })
    ).toBeTruthy();
    expect(
      screen.getByText(/Held now, charged only when your order is placed/)
    ).toBeTruthy();
  });
});

describe("SavedCardFeeSheet", () => {
  it("keeps the fee header and puts the saved method on the 3D card", () => {
    render(
      <SavedCardFeeSheet
        confirm={{
          orderId: "order-1",
          amountCents: 99,
          brand: "mastercard",
          last4: "4444",
        }}
        onAuthorize={async () => {}}
        onUseDifferentCard={async () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Service fee")).toBeTruthy();
    expect(screen.getByText("$0.99")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: /Materialize card, mastercard ending 4444/,
      })
    ).toBeTruthy();
    // The old BadgeCheck "Mastercard •••• 4444 / Saved" row is gone —
    // the 3D card is that surface now.
    expect(screen.queryByText(/^Saved$/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Authorize \$0\.99/ })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Use a different card/ })
    ).toBeTruthy();
  });
});
