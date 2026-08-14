// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockUser: { id: string } | null = null;

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: mockUser,
    isLoaded: true,
    isSignedIn: mockUser !== null,
  }),
}));

vi.mock("@/components/auth/auth-modal", () => ({
  useAuthModal: () => ({ openAuth: vi.fn(), closeAuth: vi.fn() }),
}));

vi.mock("@/components/nav/top-search", () => ({
  TopSearch: () => <div data-testid="top-search" />,
}));

vi.mock("@/components/nav/notifications-popover", () => ({
  NotificationsPopover: () => <div data-testid="bell" />,
}));

import { TopBar } from "../top-bar";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", {
    value: y,
    configurable: true,
  });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

describe("TopBar brand lockup", () => {
  beforeEach(() => {
    mockUser = null;
    setScrollY(0);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a half-height wordmark, expanded at the top of the page", () => {
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    const logo = document.querySelector(".mz-logo") as HTMLElement;
    expect(logo).toBeTruthy();
    expect(logo.dataset.mzExpanded).toBe("true");
    expect(logo.style.getPropertyValue("--mz-h")).toBe("11px");
  });

  it("collapses the wordmark to the mark after scrolling", () => {
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    setScrollY(40);
    const logo = document.querySelector(".mz-logo") as HTMLElement;
    expect(logo.dataset.mzExpanded).toBe("false");
  });

  it("re-expands the wordmark after scrolling back to the top", () => {
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    setScrollY(40);
    setScrollY(0);
    const logo = document.querySelector(".mz-logo") as HTMLElement;
    expect(logo.dataset.mzExpanded).toBe("true");
  });

  it("vertically centers the brand link on the search-row height", () => {
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    const home = screen.getByRole("link", { name: "Materialize — home" });
    expect(home.className).toMatch(/\bh-10\b/);
    expect(home.className).toMatch(/\bitems-center\b/);
    expect(home.parentElement?.className).toMatch(/\bh-10\b/);
  });

  it("gives the landing Login button the same opaque chip fill as the search bar", () => {
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    const login = screen.getByRole("button", { name: "Login" });
    expect(login.className).toMatch(/from-neutral-50/);
    expect(login.className).toMatch(/to-white/);
    expect(login.className).toMatch(/border-black\/10/);
  });

  it("uses the collapsing wordmark on authed app chrome too", () => {
    mockUser = { id: "user_1" };
    render(<TopBar initialUnreadCount={0} />);
    const logo = document.querySelector(".mz-logo") as HTMLElement;
    expect(logo).toBeTruthy();
    expect(logo.style.getPropertyValue("--mz-h")).toBe("11px");
    expect(logo.dataset.mzExpanded).toBe("true");
  });
});
