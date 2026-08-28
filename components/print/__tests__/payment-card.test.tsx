// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PaymentCardFallback,
  cardBrandLabel,
  formatUsdCents,
  paymentCardAriaLabel,
} from "../payment-card-fallback";
import { MARK_PATH } from "@/components/brand/logo-paths";
import { getMaterialById } from "@/lib/materials";
import {
  CARD_H,
  CARD_W,
  CHIP_POSITION,
  LOGO_POSITION,
} from "../payment-card-layout";

vi.mock("../payment-card-scene", () => ({
  PaymentCardScene: () => null,
}));

import { PaymentCard } from "../payment-card";

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
    const top = container.querySelector(".mz-pay-card-top");
    expect(top).not.toBeNull();
    const children = Array.from(top!.children);
    expect(children).toHaveLength(2);
    expect(children[0].classList.contains("mz-pay-card-logo")).toBe(true);
    expect(children[0].querySelector("svg")?.innerHTML).toContain(MARK_PATH);
    expect(children[1].getAttribute("data-testid")).toBe("payment-card-chip");
  });

  it("prints the service fee and the saved pan", () => {
    render(
      <PaymentCardFallback amountCents={99} brand="visa" last4="4242" saved />
    );
    expect(screen.getByText("Service fee")).toBeTruthy();
    expect(screen.getByText("$0.99")).toBeTruthy();
    expect(screen.getByText(/Visa/)).toBeTruthy();
    expect(screen.getByText(/4242/)).toBeTruthy();
  });
});

describe("PaymentCard", () => {
  it("exposes the fee on an img role while the canvas is loading", () => {
    render(<PaymentCard amountCents={99} />);
    expect(
      screen.getByRole("img", { name: /Materialize card, service fee \$0\.99/ })
    ).toBeTruthy();
    expect(screen.getByTestId("payment-card-chip")).toBeTruthy();
  });
});

describe("3D card composition", () => {
  const src = readFileSync(
    resolve(__dirname, "../payment-card-scene.tsx"),
    "utf8"
  );

  it("is a physical titanium card under studio IBL, not a CSS-only illustration", () => {
    expect(src).toContain("meshPhysicalMaterial");
    expect(src).toContain("StudioEnvironment");
    expect(src).toContain("TITANIUM");
    expect(src).toContain("SVGLoader");
    expect(src).toContain("MARK_PATH");
    expect(src).toContain("LOGO_POSITION");
    expect(src).toContain("CHIP_POSITION");
    expect(src).toContain("ContactShadows");
    expect(src).not.toContain("meshBasicMaterial");
    expect(src).not.toContain("meshToonMaterial");
  });

  it("keeps the mark on the left and the chip on the right", () => {
    expect(LOGO_POSITION[0]).toBeLessThan(0);
    expect(CHIP_POSITION[0]).toBeGreaterThan(0);
    expect(LOGO_POSITION[1]).toBeGreaterThan(0);
    expect(CHIP_POSITION[1]).toBeGreaterThan(0);
    expect(CARD_W / CARD_H).toBeCloseTo(85.6 / 53.98, 2);
  });

  it("paints the body as catalog titanium, chip as gold metal", () => {
    expect(src).toContain(getMaterialById("titanium")!.color);
    expect(src).toContain("metalness: 1");
    expect(src).toContain("#c9a227");
    expect(src).toContain("CHIP_GOLD");
  });
});
