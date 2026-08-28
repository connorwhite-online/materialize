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
  LOGO_WIDTH,
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
    const logo = container.querySelector(".mz-pay-card-logo");
    expect(logo).not.toBeNull();
    expect(logo!.querySelector("svg")?.innerHTML).toContain(MARK_PATH);
    // Chip is absolutely positioned on the right midline — a sibling of
    // the top row, not nested inside it.
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
    // No amount → no mid-body kicker. The mark stands alone; the
    // bottom row is just the brand + pan, left-aligned.
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
  it("exposes the fee on an img role while the canvas is loading", () => {
    render(<PaymentCard amountCents={99} />);
    expect(
      screen.getByRole("img", { name: /Materialize card, service fee \$0\.99/ })
    ).toBeTruthy();
    expect(screen.getByTestId("payment-card-chip")).toBeTruthy();
  });

  it("runs the enter animation class on the wrapper", () => {
    const { container } = render(<PaymentCard amountCents={99} />);
    expect(container.querySelector(".mz-pay-card-enter")).not.toBeNull();
  });
});

describe("3D card composition", () => {
  const src = readFileSync(
    resolve(__dirname, "../payment-card-scene.tsx"),
    "utf8"
  );
  const css = readFileSync(
    resolve(__dirname, "../../../app/globals.css"),
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

  it("keeps the mark on the left and the chip centered on the right", () => {
    expect(LOGO_POSITION[0]).toBeLessThan(0);
    expect(CHIP_POSITION[0]).toBeGreaterThan(0);
    expect(LOGO_POSITION[1]).toBeGreaterThan(0);
    // Vertically centered — not parked in the top-right corner.
    expect(CHIP_POSITION[1]).toBe(0);
    expect(CARD_W / CARD_H).toBeCloseTo(85.6 / 53.98, 2);
    expect(LOGO_WIDTH).toBeGreaterThan(0.35);
  });

  it("paints the body as catalog titanium, chip as gold metal", () => {
    expect(src).toContain(getMaterialById("titanium")!.color);
    expect(src).toContain("metalness: 1");
    expect(src).toContain("#c9a227");
    expect(src).toContain("CHIP_GOLD");
  });

  it("brushes the titanium body with grain + anisotropy", () => {
    expect(src).toContain("makeBrushedTitaniumMaps");
    expect(src).toContain("anisotropy");
    expect(src).toContain("roughnessMap");
    expect(src).toContain("BrushedTitaniumMaterial");
    // CSS fallback mirrors the brush with repeating streaks under
    // the face chrome (not an overlay that would mute the chip).
    expect(css).toContain("repeating-linear-gradient");
    expect(css).toMatch(
      /\.mz-pay-card-face\s*\{[^}]*repeating-linear-gradient/
    );
  });

  it("spins / fades / scales in on appear", () => {
    expect(css).toContain("@keyframes mz-pay-card-enter");
    expect(css).toContain("mz-pay-card-enter");
    expect(css).toMatch(/rotateY\(10[0-9]deg\)/);
    expect(css).toContain("scale(0.82)");
  });

  it("left-aligns the pan and omits the Materialize face word", () => {
    // The extruded mark is the brand — a second MATERIALIZE string
    // on the face was redundant and fought the pan for the bottom row.
    expect(src).not.toMatch(/>\s*MATERIALIZE\s*</);
    expect(src).toContain('anchorX="left"');
    expect(src).not.toContain('anchorX="right"');
    expect(css).toMatch(
      /\.mz-pay-card-bottom\s*\{[^}]*justify-content:\s*flex-start/
    );
  });
});
