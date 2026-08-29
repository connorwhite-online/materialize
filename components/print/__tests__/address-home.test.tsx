// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AddressHomeFallback,
  addressHomeAriaLabel,
} from "../address-home-fallback";

vi.mock("../address-home-scene", () => ({
  AddressHomeScene: () => null,
}));

import { AddressHome } from "../address-home";

describe("address home labels", () => {
  it("names the cartoon house for assistive tech", () => {
    expect(addressHomeAriaLabel()).toBe("Cartoon house with a red front door");
  });
});

describe("AddressHomeFallback", () => {
  it("paints a chunky white house with a red door and chimney", () => {
    render(<AddressHomeFallback />);
    expect(screen.getByTestId("address-home-door")).toBeTruthy();
    expect(screen.getByTestId("address-home-chimney")).toBeTruthy();
    const svg = screen.getByTestId("address-home-fallback-svg");
    expect(svg.innerHTML).toContain("#d62828");
    expect(svg.innerHTML).toContain("#ffffff");
    expect(svg.innerHTML).toContain("#8a5a48");
  });
});

describe("AddressHome", () => {
  it("exposes the house on an img role while the canvas is loading", () => {
    render(<AddressHome />);
    expect(
      screen.getByRole("img", { name: "Cartoon house with a red front door" })
    ).toBeTruthy();
    expect(screen.getByTestId("address-home-fallback")).toBeTruthy();
  });

  it("runs the shared enter animation class on the wrapper", () => {
    const { container } = render(<AddressHome />);
    expect(container.querySelector(".mz-pay-card-enter")).not.toBeNull();
  });

  it("keeps the CSS fallback mounted so a dead WebGL context can't blank the hero", () => {
    render(<AddressHome />);
    expect(screen.getByTestId("address-home-fallback")).toBeTruthy();
    expect(screen.getByTestId("address-home-door")).toBeTruthy();
    const src = readFileSync(resolve(__dirname, "../address-home.tsx"), "utf8");
    expect(src).toContain("Permanent underlay");
    expect(src).not.toContain("{!live && (");
    // Canvas stays painted — fading it out until ready can skip the
    // first WebGL frame and leave only the SVG underlay.
    expect(src).not.toMatch(/className=\{[\s\S]*opacity-0/);
    expect(screen.getByTestId("address-home-webgl")).toBeTruthy();
  });
});

describe("3D cartoon house composition", () => {
  const src = readFileSync(
    resolve(__dirname, "../address-home-scene.tsx"),
    "utf8"
  );
  const css = readFileSync(
    resolve(__dirname, "../../../app/globals.css"),
    "utf8"
  );

  it("is a chunky physical toy under local lights, not a flat illustration", () => {
    expect(src).toContain("meshStandardMaterial");
    expect(src).toContain("ContactShadows");
    expect(src).toContain("ReadySignal");
    expect(src).toContain("ChunkyHouse");
    expect(src).toContain("coneGeometry");
    expect(src).toContain("RoundedBox");
    expect(src).toContain('frameloop="always"');
    expect(src).not.toContain("meshBasicMaterial");
    expect(src).not.toContain("meshToonMaterial");
    // Sheet toys skip PMREM — fee-card IBL has blanked software GL.
    expect(src).not.toMatch(/from ["']@\/components\/viewer\/studio-environment["']/);
    // Keep the part count low — no mailbox / flowerboxes / smoke.
    expect(src).not.toContain("Mailbox");
    expect(src).not.toContain("Smoke");
    expect(src).not.toContain("FlowerBox");
  });

  it("keeps the white paint, saturated red door, and chimney", () => {
    expect(src).toContain("#fff8f0");
    expect(src).toContain("#d62828");
    expect(src).toContain("#8a5a48");
  });

  it("reuses the fee-sheet enter so the house settles the same way", () => {
    expect(css).toContain(".mz-addr-home");
    expect(css).toContain("@keyframes mz-pay-card-enter");
  });
});
