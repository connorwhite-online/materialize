// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PaymentCardFallback,
  cardBrandLabel,
  formatUsdCents,
  paymentCardAriaLabel,
} from "../payment-card-fallback";
import { MARK_PATH } from "@/components/brand/logo-paths";
import {
  CARD_H,
  CARD_RADIUS,
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

import { PaymentCard, WEBGL_FALLBACK_MS } from "../payment-card";

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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes the fee on an img role while WebGL is pending", () => {
    render(<PaymentCard amountCents={99} />);
    expect(
      screen.getByRole("img", { name: /Materialize card, service fee \$0\.99/ })
    ).toBeTruthy();
    expect(screen.queryByTestId("payment-card-fallback")).toBeNull();
  });

  it("holds an empty slot until WebGL times out, then shows CSS alone", () => {
    vi.useFakeTimers();
    const { container } = render(
      <PaymentCard amountCents={99} brand="visa" last4="4242" />
    );
    expect(container.querySelector("[data-surface='pending']")).not.toBeNull();
    expect(screen.queryByTestId("payment-card-fallback")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(WEBGL_FALLBACK_MS);
    });

    expect(container.querySelector("[data-surface='fallback']")).not.toBeNull();
    expect(screen.getByTestId("payment-card-fallback")).toBeTruthy();
    expect(container.querySelector(".mz-pay-card-enter")).not.toBeNull();
  });

  it("never crossfades CSS and WebGL — one surface wins", () => {
    const src = readFileSync(
      resolve(__dirname, "../payment-card.tsx"),
      "utf8"
    );
    expect(src).toContain('CardSurface = "pending" | "live" | "fallback"');
    expect(src).toContain("WEBGL_FALLBACK_MS");
    expect(src).toContain("payment-card-scene");
  });
});

describe("thin WebGL plate", () => {
  const src = readFileSync(
    resolve(__dirname, "../payment-card-scene.tsx"),
    "utf8"
  );
  const css = readFileSync(
    resolve(__dirname, "../../../app/globals.css"),
    "utf8"
  );

  it("is a thin plate — not the old chunky slab", () => {
    // Real ID-1 ≈ 0.014 card-heights; the bubbly pass used 0.05.
    expect(CARD_T).toBeLessThanOrEqual(0.02);
    expect(CARD_T).toBeGreaterThan(0.008);
    expect(CARD_RADIUS).toBeLessThanOrEqual(0.05);
    expect(CARD_W / CARD_H).toBeCloseTo(85.6 / 53.98, 2);
  });

  it("keeps the mark on the left and the chip on the right midline", () => {
    expect(LOGO_POSITION[0]).toBeLessThan(0);
    expect(CHIP_POSITION[0]).toBeGreaterThan(0);
    expect(CHIP_POSITION[1]).toBe(0);
    expect(LOGO_WIDTH).toBeGreaterThan(0.35);
    expect(FACE_LIFT).toBeGreaterThan(0);
    expect(LOGO_POSITION[2]).toBeGreaterThan(CARD_T / 2);
  });

  it("paints a flat mark decal — no bevelled extrusion", () => {
    expect(src).toContain("bevelEnabled: false");
    expect(src).toContain("StudioEnvironment");
    expect(src).toContain("meshPhysicalMaterial");
    expect(src).toContain("ReadySignal");
    expect(src).not.toContain("bevelThickness");
    expect(src).not.toContain("bevelSize");
    // Rest pose matches the CSS face tilt (12° / −16°).
    expect(src).toContain("REST_X");
    expect(src).toContain("REST_Y");
    expect(src).toMatch(/12\s*\*\s*Math\.PI/);
    expect(src).toMatch(/-16\s*\*\s*Math\.PI/);
  });

  it("does not promote WebGL on the first frame (no live→CSS flash)", () => {
    // Regression: ReadySignal called onReady on frame 1; SwiftShader
    // then lost the context and the fee sheet flashed 3D → CSS.
    expect(src).toContain("WEBGL_STABLE_MS");
    expect(src).toContain("isSoftwareRenderer");
    expect(src).toMatch(/WEBGL_STABLE_MS\s*=\s*[5-9]\d{2}/);
    const wrapper = readFileSync(
      resolve(__dirname, "../payment-card.tsx"),
      "utf8"
    );
    expect(wrapper).toContain("failedRef");
  });

  it("soft-fades the wrapper once a surface wins", () => {
    expect(css).toContain("@keyframes mz-pay-card-enter");
    expect(css).toContain("--ease-out-soft");
    expect(css).not.toMatch(/rotateY\(10[0-9]deg\)/);
  });
});
