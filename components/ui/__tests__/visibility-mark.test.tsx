// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PrivateCardMark,
  VisibilityLabelIcon,
} from "@/components/ui/visibility-mark";

describe("PrivateCardMark", () => {
  it("is icon-only with an accessible Private label", () => {
    render(<PrivateCardMark />);
    const mark = screen.getByLabelText("Private");
    expect(mark).toBeTruthy();
    // No visible "Private" text — aria-label / title only.
    expect(mark.textContent?.replace(/\s/g, "")).toBe("");
    expect(mark.querySelector("svg")).toBeTruthy();
  });
});

describe("VisibilityLabelIcon", () => {
  it("renders an svg for both visibility values", () => {
    const { rerender, container } = render(
      <VisibilityLabelIcon visibility="public" />
    );
    expect(container.querySelector("svg")).toBeTruthy();
    rerender(<VisibilityLabelIcon visibility="private" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
