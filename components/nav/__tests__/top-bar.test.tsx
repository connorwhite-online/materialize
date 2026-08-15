// @vitest-environment jsdom
/**
 * Anon desktop chrome: one Login treatment (secondary) on landing and
 * app routes, and the landing wordmark collapses into a taller mark
 * after the first nudge of scroll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";

let mockUser: { id: string } | null = null;

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: mockUser,
    isLoaded: true,
    isSignedIn: mockUser !== null,
  }),
}));

const openAuth = vi.fn();
vi.mock("@/components/auth/auth-modal", () => ({
  useAuthModal: () => ({ openAuth, closeAuth: vi.fn() }),
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
    writable: true,
  });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  mockUser = null;
  openAuth.mockClear();
  setScrollY(0);
});

afterEach(() => {
  cleanup();
});

describe("TopBar anon Login", () => {
  it("uses the secondary button on the landing page and on app chrome", () => {
    const { rerender } = render(
      <TopBar initialUnreadCount={0} alwaysVisible />
    );
    const login = () => screen.getByRole("button", { name: /login/i });
    expect(login().className).toContain("bg-secondary");
    expect(login().className).not.toContain("bg-primary");

    rerender(<TopBar initialUnreadCount={0} />);
    expect(login().className).toContain("bg-secondary");
    expect(login().className).not.toContain("bg-primary");
  });

  it("opens the auth modal from Login", () => {
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    expect(openAuth).toHaveBeenCalledWith("sign-in");
  });
});

describe("TopBar landing wordmark", () => {
  it("plays the mount reveal until the first scroll, then collapses", () => {
    render(<TopBar initialUnreadCount={0} landing />);
    const logo = () => document.querySelector(".mz-logo") as HTMLElement;

    expect(logo()).toBeTruthy();
    expect(logo().dataset.mzMode).toBe("mount");
    expect(logo().dataset.mzExpanded).toBe("true");

    setScrollY(40);

    expect(logo().dataset.mzMode).toBe("toggle");
    expect(logo().dataset.mzExpanded).toBe("false");
    // Word size stays 22px; the M grows via --mz-mark-scale on
    // `.mz-logo-mark` (not the whole SVG).
    expect(logo().style.getPropertyValue("--mz-h")).toBe("22px");

    setScrollY(0);
    expect(logo().dataset.mzExpanded).toBe("true");
  });

  it("does not collapse the wordmark on app chrome (logomark only)", () => {
    render(<TopBar initialUnreadCount={0} />);
    expect(document.querySelector(".mz-logo")).toBeNull();

    setScrollY(80);
    expect(document.querySelector(".mz-logo")).toBeNull();
  });

  it("vertically centers the brand link on the search-row height", () => {
    render(<TopBar initialUnreadCount={0} landing />);
    const home = screen.getByRole("link", { name: "Materialize — home" });
    expect(home.className).toMatch(/\bh-10\b/);
    expect(home.className).toMatch(/\bitems-center\b/);
    expect(home.parentElement?.className).toMatch(/\bh-10\b/);
  });

  it("feathers the landing hero with blur instead of a background wash", () => {
    const { rerender } = render(<TopBar initialUnreadCount={0} landing />);
    const feather = () =>
      document.querySelector("[data-nav-feather]") as HTMLElement;

    expect(feather().className).toMatch(/backdrop-blur/);
    expect(feather().className).not.toMatch(/bg-gradient-to-b/);
    expect(feather().style.maskImage).toMatch(/linear-gradient/);

    rerender(<TopBar initialUnreadCount={0} />);
    expect(feather().className).toMatch(/bg-gradient-to-b/);
    expect(feather().className).not.toMatch(/backdrop-blur/);
  });
});
