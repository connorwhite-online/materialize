// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ShippingDropFallback,
  shippingDropAriaLabel,
} from "../shipping-drop-fallback";

vi.mock("../shipping-drop-scene", () => ({
  ShippingDropScene: () => null,
}));

import { ShippingDrop } from "../shipping-drop";

describe("shipping drop labels", () => {
  it("names the parachute box for assistive tech", () => {
    expect(shippingDropAriaLabel()).toBe(
      "Cardboard package descending on a parachute"
    );
  });
});

describe("ShippingDrop", () => {
  it("exposes the drop on an img role while the canvas is loading", () => {
    render(<ShippingDrop />);
    expect(
      screen.getByRole("img", {
        name: "Cardboard package descending on a parachute",
      })
    ).toBeTruthy();
    expect(screen.getByTestId("shipping-drop-fallback")).toBeTruthy();
    expect(screen.getByTestId("shipping-drop-fallback-svg")).toBeTruthy();
  });

  it("runs the shared enter animation class on the wrapper", () => {
    const { container } = render(<ShippingDrop />);
    expect(container.querySelector(".mz-pay-card-enter")).not.toBeNull();
  });

  it("keeps the CSS fallback mounted so a dead WebGL context can't blank the hero", () => {
    render(<ShippingDrop />);
    const src = readFileSync(resolve(__dirname, "../shipping-drop.tsx"), "utf8");
    expect(src).toContain("Permanent underlay");
    expect(src).not.toContain("{!live && (");
  });
});

describe("3D parachute-box composition", () => {
  const src = readFileSync(
    resolve(__dirname, "../shipping-drop-scene.tsx"),
    "utf8"
  );

  it("is a physical cardboard box + canopy under studio IBL", () => {
    expect(src).toContain("meshPhysicalMaterial");
    expect(src).toContain("StudioEnvironment");
    expect(src).toContain("ContactShadows");
    expect(src).toContain("ReadySignal");
    expect(src).toContain("ParachuteCanopy");
    expect(src).toContain("CARDBOARD");
    expect(src).not.toContain("meshToonMaterial");
  });
});

describe("ShippingDropFallback", () => {
  it("still shows the canopy and box when WebGL is missing", () => {
    render(<ShippingDropFallback />);
    const svg = screen.getByTestId("shipping-drop-fallback-svg");
    expect(svg.innerHTML).toContain("#e24b4b");
    expect(svg.innerHTML).toContain("#c89655");
  });
});
