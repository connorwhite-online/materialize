// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PaymentCardFallback,
  cardBrandLabel,
  formatUsdCents,
  paymentCardAriaLabel,
} from "../payment-card-fallback";
import { PaymentCard } from "../payment-card";
import { MARK_PATH } from "@/components/brand/logo-paths";

describe("payment card labels", () => {
  it("formats the fee in USD", () => {
    expect(formatUsdCents(99)).toBe("$0.99");
    expect(formatUsdCents(500)).toBe("$5.00");
  });

  it("names common brands", () => {
    expect(cardBrandLabel("visa")).toBe("Visa");
    expect(cardBrandLabel("amex")).toBe("Amex");
    expect(cardBrandLabel("link")).toBe("Link");
  });

  it("builds an accessible name from fee + last4", () => {
    expect(
      paymentCardAriaLabel({
        amountCents: 99,
        brand: "visa",
        last4: "4242",
        saved: true,
      })
    ).toBe("Materialize card, service fee $0.99, Visa ending 4242, saved");
  });
});

describe("PaymentCardFallback", () => {
  it("puts the Materialize mark on the left and the metal chip on the right", () => {
    const { container } = render(
      <PaymentCardFallback amountCents={99} brand="visa" last4="4242" />
    );
    const logo = container.querySelector(".mz-pay-card-logo");
    expect(logo).not.toBeNull();
    expect(logo!.querySelector("svg")?.innerHTML).toContain(MARK_PATH);
    expect(screen.getByTestId("payment-card-chip")).toBeTruthy();
    expect(
      container.querySelector(".mz-pay-card-top")?.contains(
        screen.getByTestId("payment-card-chip")
      )
    ).toBe(false);
  });

  it("prints the left-aligned pan and no Materialize word on the face", () => {
    const { container } = render(
      <PaymentCardFallback brand="visa" last4="4242" saved />
    );
    expect(screen.queryByText("Service fee")).toBeNull();
    expect(screen.queryByText(/Materialize/i)).toBeNull();
    expect(container.querySelector(".mz-pay-card-name")).toBeNull();
    expect(screen.getByText(/Visa/)).toBeTruthy();
    expect(screen.getByText(/4242/)).toBeTruthy();
    const bottom = container.querySelector(".mz-pay-card-bottom");
    expect(bottom?.className).not.toMatch(/space-between|justify-between/);
  });

  it("still prints the fee on the face when an amount is provided", () => {
    render(
      <PaymentCardFallback amountCents={99} brand="visa" last4="4242" saved />
    );
    expect(screen.getByText("Service fee")).toBeTruthy();
    expect(screen.getByText("$0.99")).toBeTruthy();
  });
});

describe("PaymentCard", () => {
  it("exposes the fee on an img role with the flat CSS face", () => {
    render(<PaymentCard amountCents={99} brand="visa" last4="4242" />);
    expect(
      screen.getByRole("img", { name: /Materialize card, service fee \$0\.99/ })
    ).toBeTruthy();
    expect(screen.getByTestId("payment-card-fallback")).toBeTruthy();
    expect(screen.getByTestId("payment-card-chip")).toBeTruthy();
  });

  it("runs the enter animation class on the wrapper", () => {
    const { container } = render(<PaymentCard amountCents={99} />);
    expect(container.querySelector(".mz-pay-card-enter")).not.toBeNull();
  });

  it("is CSS-only — no WebGL twin on the checkout path", () => {
    const src = readFileSync(
      resolve(__dirname, "../payment-card.tsx"),
      "utf8"
    );
    expect(src).toContain("PaymentCardFallback");
    expect(src).toContain("CSS only");
    expect(src).not.toContain("next/dynamic");
    expect(src).not.toContain("payment-card-scene");
    expect(src).not.toContain("PaymentCardScene");
    expect(src).not.toContain("@react-three/fiber");
  });
});

describe("payment card CSS face", () => {
  const css = readFileSync(
    resolve(__dirname, "../../../app/globals.css"),
    "utf8"
  );

  it("soft-fades / lifts / scales in on appear (no hard spin)", () => {
    expect(css).toContain("@keyframes mz-pay-card-enter");
    expect(css).toContain("mz-pay-card-enter");
    expect(css).toMatch(/rotateY\(-?2[0-9]deg\)/);
    expect(css).toContain("scale(0.94)");
    expect(css).toContain("translateY(10px)");
    expect(css).toContain("--ease-out-soft");
    expect(css).not.toMatch(/rotateY\(10[0-9]deg\)/);
  });

  it("left-aligns the pan and paints clean metallic titanium", () => {
    expect(css).toMatch(
      /\.mz-pay-card-bottom\s*\{[^}]*justify-content:\s*flex-start/
    );
    expect(css).toContain("#6e6e72");
    expect(css).not.toMatch(
      /\.mz-pay-card-face\s*\{[^}]*repeating-linear-gradient/
    );
  });

  it("lifts the card with a soft drop shadow under the tilted face", () => {
    expect(css).toContain(".mz-pay-card::before");
    expect(css).toMatch(/\.mz-pay-card::before\s*\{[^}]*blur\(/);
  });
});
