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
  CARD_T,
  CARD_W,
  CHIP_POSITION,
  FACE_LIFT,
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

  it("keeps the CSS fallback mounted so a dead WebGL context can't blank the card", () => {
    // Regression: unmounting on ready left a blank hole when SwiftShader
    // then lost the context. Mount always; hide only while live.
    render(<PaymentCard amountCents={99} brand="visa" last4="4242" />);
    expect(screen.getByTestId("payment-card-fallback")).toBeTruthy();
    expect(screen.getByTestId("payment-card-chip")).toBeTruthy();
    const src = readFileSync(
      resolve(__dirname, "../payment-card.tsx"),
      "utf8"
    );
    expect(src).toContain("Mounted always");
    expect(src).toContain("opacity-0");
    expect(src).not.toContain("{!live && (");
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
    expect(src).toContain("ReadySignal");
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

  it("lifts face chrome above the body so the logo can't z-fight", () => {
    // Coplanar mark + body (LOGO_POSITION.z === CARD_T/2) shimmered
    // under IBL during idle tilt. FACE_LIFT keeps a clear gap.
    expect(FACE_LIFT).toBeGreaterThan(0);
    expect(LOGO_POSITION[2]).toBeGreaterThan(CARD_T / 2);
    expect(CHIP_POSITION[2]).toBeGreaterThan(CARD_T / 2);
    expect(src).toContain("polygonOffset");
    expect(src).toContain("FACE_LIFT");
  });

  it("paints the body as catalog titanium, chip as gold metal", () => {
    // Bias lighter than the raw catalog stop — ACES + IBL crush mid
    // gray metal toward black on phone GPUs. Still the titanium row.
    expect(getMaterialById("titanium")!.color).toBe("#6e6e72");
    expect(src).toContain("#8e8e96");
    expect(src).toMatch(/metalness:\s*0\.9/);
    expect(src).toContain("#c9a227");
    expect(src).toContain("CHIP_GOLD");
  });

  it("paints a clean metallic body — no brush maps or anisotropy", () => {
    expect(src).toContain("clearcoat");
    expect(src).toContain("envMapIntensity");
    expect(src).not.toContain("makeBrushedTitaniumMaps");
    expect(src).not.toContain("anisotropy");
    expect(src).not.toContain("roughnessMap");
    expect(src).not.toContain("BrushedTitaniumMaterial");
    expect(css).not.toMatch(
      /\.mz-pay-card-face\s*\{[^}]*repeating-linear-gradient/
    );
  });

  it("soft-fades / lifts / scales in on appear (no hard spin)", () => {
    expect(css).toContain("@keyframes mz-pay-card-enter");
    expect(css).toContain("mz-pay-card-enter");
    // Gentle arc — the old 105° spring-overshoot fought the sheet.
    expect(css).toMatch(/rotateY\(-?2[0-9]deg\)/);
    expect(css).toContain("scale(0.94)");
    expect(css).toContain("translateY(10px)");
    expect(css).toContain("--ease-out-soft");
    expect(css).not.toMatch(/rotateY\(10[0-9]deg\)/);
    expect(css).not.toContain("scale(0.82)");
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
