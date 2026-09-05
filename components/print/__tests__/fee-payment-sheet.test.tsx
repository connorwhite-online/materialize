// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    className,
  }: {
    amountCents?: number;
    brand?: string;
    last4?: string | null;
    className?: string;
  }) => (
    <div
      role="img"
      data-classname={className}
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
    const authorize = screen.getByRole("button", { name: /Authorize \$0\.99/ });
    expectPrimaryButton(authorize);
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
    const card = screen.getByRole("img", {
      name: /Materialize card, mastercard ending 4444/,
    });
    expect(card).toBeTruthy();
    // Compact on this sheet — a bit smaller than the default billing card.
    expect(card.getAttribute("data-classname")).toContain("max-w-[16rem]");
    // The old BadgeCheck "Mastercard •••• 4444 / Saved" row is gone —
    // the 3D card is that surface now.
    expect(screen.queryByText(/^Saved$/)).toBeNull();
    const authorize = screen.getByRole("button", { name: /Authorize \$0\.99/ });
    expectPrimaryButton(authorize);
    const switchCard = screen.getByRole("button", {
      name: /Use a different card/,
    });
    expect(switchCard.getAttribute("data-slot")).toBe("button");
    expect(switchCard.className).not.toMatch(/bg-primary/);
  });
});

describe("fee sheet primary CTA", () => {
  it("uses the design-system Button, not a hand-rolled primary pill", () => {
    const src = readFileSync(
      resolve(__dirname, "../fee-payment-sheet.tsx"),
      "utf8"
    );
    expect(src).toContain('from "@/components/ui/button"');
    expect(src).toContain('size="lg"');
    expect(src).toContain('variant="ghost"');
    expect(src).not.toContain(
      "rounded-2xl bg-primary px-4 py-3.5 text-center text-[15px] font-semibold"
    );
  });

  it("gives the card vertical breathing room on both fee sheets", () => {
    const src = readFileSync(
      resolve(__dirname, "../fee-payment-sheet.tsx"),
      "utf8"
    );
    // Both SavedCardFeeSheet and FeePaymentSheet wrap PaymentCard in
    // my-5 so it isn't tight against the copy above / CTA below.
    expect(src.match(/my-5/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

function expectPrimaryButton(button: HTMLElement) {
  expect(button.getAttribute("data-slot")).toBe("button");
  // Same tokens as `<Button size="lg">` (Proceed to checkout, etc.):
  // filled primary, pill, symmetric elevation — not a hand-rolled block.
  expect(button.className).toMatch(/bg-primary/);
  expect(button.className).toMatch(/text-primary-foreground/);
  expect(button.className).toMatch(/rounded-full/);
  expect(button.className).toMatch(/shadow-raised-on-dark/);
  expect(button.className).toMatch(/\bh-10\b/);
}
