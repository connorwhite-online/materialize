// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CapturePreviewStatusIcon } from "../capture-preview-status-icon";

describe("CapturePreviewStatusIcon", () => {
  it("spins the dotted ring while capturing", () => {
    const { container } = render(
      <CapturePreviewStatusIcon status="capturing" />
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains("animate-spin")).toBe(true);
    const circle = container.querySelector("circle");
    expect(circle?.getAttribute("stroke-linecap")).toBe("round");
    // Round-cap zero-length dashes = dots (not long dashes).
    expect(circle?.getAttribute("stroke-dasharray")).toBe("0 6.5");
  });

  it("shows a filled check circle when saved", () => {
    const { container } = render(<CapturePreviewStatusIcon status="saved" />);
    const circle = container.querySelector("circle");
    expect(circle?.getAttribute("fill")).toBe("currentColor");
    const check = container.querySelector("path");
    expect(check?.getAttribute("stroke")).toBe("var(--background)");
    expect(check?.getAttribute("stroke-linecap")).toBe("round");
  });

  it("keeps the frame-corners viewfinder when idle or errored", () => {
    for (const status of ["idle", "error"] as const) {
      const { container } = render(
        <CapturePreviewStatusIcon status={status} />
      );
      // FrameCorners is four L-bracket paths, not a circle.
      expect(container.querySelectorAll("path").length).toBe(4);
      expect(container.querySelector("circle")).toBeNull();
    }
  });
});
