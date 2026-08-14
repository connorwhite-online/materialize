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

vi.mock("@/components/print/cart-context", () => ({
  useCart: () => null,
}));

import { TopBar } from "../top-bar";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", {
    value: y,
    configurable: true,
    writable: true,
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
    render(<TopBar initialUnreadCount={0} alwaysVisible />);
    const logo = () => document.querySelector(".mz-logo") as HTMLElement;

    expect(logo()).toBeTruthy();
    expect(logo().dataset.mzMode).toBe("mount");
    expect(logo().dataset.mzExpanded).toBe("true");

    setScrollY(40);
    act(() => window.dispatchEvent(new Event("scroll")));

    expect(logo().dataset.mzMode).toBe("toggle");
    expect(logo().dataset.mzExpanded).toBe("false");

    setScrollY(0);
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(logo().dataset.mzExpanded).toBe("true");
  });

  it("does not collapse the wordmark on app chrome (logomark only)", () => {
    render(<TopBar initialUnreadCount={0} />);
    expect(document.querySelector(".mz-logo")).toBeNull();

    setScrollY(80);
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(document.querySelector(".mz-logo")).toBeNull();
  });
});
