// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OwnerSettingsTabs } from "../owner-settings-tabs";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("OwnerSettingsTabs", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("renders Settings / Agents / Payments as shared segmented tabs", () => {
    const { container } = render(
      <OwnerSettingsTabs username="ada" activeTab="settings" />
    );

    expect(screen.getByRole("tab", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Payments" })).toBeTruthy();

    const list = container.querySelector('[data-slot="tabs-list"]');
    expect(list?.className).toMatch(/bg-muted/);
    expect(container.querySelector(".border-b")).toBeNull();
  });

  it("navigates when a tab is selected", () => {
    render(<OwnerSettingsTabs username="ada" activeTab="settings" />);

    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    });

    expect(push).toHaveBeenCalledWith("/ada?tab=agents", { scroll: false });
  });
});
