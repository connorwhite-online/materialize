// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ProfileTabs } from "../profile-tabs";

// Regression for React error #310 on the owner profile. The tab
// underline used a per-button `motion.div layoutId` shared-layout
// transition (motion's layout projection) which, under React 19 +
// motion 12, rendered a varying number of hooks across the
// measure/commit phase and threw #310. The measured single-indicator
// implementation must mount the full owner tab set and switch tabs
// without throwing.
//
// jsdom has no layout engine and no ResizeObserver; the component
// guards the observer and getBoundingClientRect returns zeros here, so
// this asserts the hooks/render contract rather than pixel positions.

describe("ProfileTabs", () => {
  it("renders the full owner tab set without throwing", () => {
    expect(() =>
      render(
        <ProfileTabs
          username="ada"
          activeTab="library"
          isOwner
          unreadNotifications={2}
        />
      )
    ).not.toThrow();

    expect(screen.getByText("Library")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Earnings")).toBeTruthy();
  });

  it("shows only the Library tab for non-owners", () => {
    render(<ProfileTabs username="ada" activeTab="library" isOwner={false} />);
    expect(screen.getByText("Library")).toBeTruthy();
    expect(screen.queryByText("Orders")).toBeNull();
    expect(screen.queryByText("Earnings")).toBeNull();
  });

  it("switches the active tab without throwing", () => {
    render(<ProfileTabs username="ada" activeTab="library" isOwner />);
    const orders = screen.getByText("Orders");
    expect(() => {
      act(() => {
        fireEvent.click(orders);
      });
    }).not.toThrow();
    expect(orders.closest("button")?.getAttribute("aria-current")).toBe("page");
  });
});
