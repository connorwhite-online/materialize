// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SegmentedControl } from "../segmented-control";

describe("SegmentedControl", () => {
  it("renders items as tabs with the shared pill-track list", () => {
    const { container } = render(
      <SegmentedControl
        defaultValue="a"
        items={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />
    );

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Beta" })).toBeTruthy();

    const list = container.querySelector('[data-slot="tabs-list"]');
    expect(list?.getAttribute("data-variant")).toBe("default");
    expect(list?.className).toMatch(/bg-muted/);
  });

  it("calls onValueChange when a tab is selected", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        value="a"
        onValueChange={onValueChange}
        items={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />
    );

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    });

    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});
