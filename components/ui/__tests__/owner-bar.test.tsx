// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OwnerBar } from "@/components/ui/owner-bar";

describe("OwnerBar", () => {
  it("shows an eye icon before the Public label", () => {
    render(<OwnerBar visibility="public" />);
    const label = screen.getByText("Public");
    expect(label).toBeTruthy();
    const chip = label.closest("span");
    expect(chip?.querySelector("svg")).toBeTruthy();
  });

  it("shows an eye-off icon before the Private label", () => {
    render(<OwnerBar visibility="private" />);
    const label = screen.getByText("Private");
    expect(label).toBeTruthy();
    const chip = label.closest("span");
    expect(chip?.querySelector("svg")).toBeTruthy();
  });
});
