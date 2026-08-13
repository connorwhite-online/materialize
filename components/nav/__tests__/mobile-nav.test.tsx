// @vitest-environment jsdom
/**
 * Behaviour of the morphing mobile nav: the collapsed pill names the
 * current page, tapping it discloses the destination menu plus the
 * user container, and anon visitors get a sign-in row instead of an
 * inbox they can't read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";

let mockUser: {
  id: string;
  username: string | null;
  fullName: string | null;
  hasImage: boolean;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
} | null = {
  id: "user_1",
  username: "connorwhite",
  fullName: "Connor White",
  hasImage: false,
  imageUrl: "",
  primaryEmailAddress: { emailAddress: "connor@example.com" },
};

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

let mockCartCount = 0;
vi.mock("@/components/print/cart-context", () => ({
  useCart: () => ({ itemCount: mockCartCount }),
}));

vi.mock("@/lib/hooks/use-keyboard-sticky-bottom", () => ({
  useKeyboardOpen: () => false,
}));

vi.mock("@/lib/hooks/use-unread-count", () => ({
  useUnreadCount: (initial: number) => initial,
}));

import { MobileNav } from "../mobile-nav";

/** The collapsed pill itself — "<page title> — open navigation menu". */
const trigger = () =>
  screen.getByRole("button", { name: /— open navigation menu$/i });

/** Tap the collapsed pill and let the disclosure's state settle. */
async function openMenu() {
  await act(async () => {
    fireEvent.click(trigger());
  });
}

beforeEach(() => {
  mockCartCount = 0;
  mockUser = {
    id: "user_1",
    username: "connorwhite",
    fullName: "Connor White",
    hasImage: false,
    imageUrl: "",
    primaryEmailAddress: { emailAddress: "connor@example.com" },
  };
  vi.mocked(usePathname).mockReturnValue("/");
  openAuth.mockClear();
});

describe("MobileNav", () => {
  it("shows the brand mark alone on home — no title in the pill", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    render(<MobileNav initialUnreadCount={0} />);

    // Named for assistive tech, but the word isn't painted next to the mark.
    expect(trigger().getAttribute("aria-label")).toBe(
      "Home — open navigation menu"
    );
    expect(trigger().textContent).toBe("");
  });

  it("collapses to the current page's title and stays closed until tapped", () => {
    vi.mocked(usePathname).mockReturnValue("/materials");
    render(<MobileNav initialUnreadCount={0} />);

    expect(
      screen.getByRole("button", { name: "Materials — open navigation menu" })
    ).toBeTruthy();
    expect(trigger().textContent).toContain("Materials");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
  });

  it("discloses the destinations and the user container when tapped", async () => {
    render(<MobileNav initialUnreadCount={0} />);

    await openMenu();

    const menu = screen.getByRole("navigation", { name: "Primary" });
    expect(
      Array.from(menu.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    ).toEqual(["/", "/files", "/print", "/materials", "/notifications"]);
    // The desktop-style user container takes over the pill's row.
    expect(screen.getByText("Connor White")).toBeTruthy();
    expect(screen.getByText("@connorwhite")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Close navigation menu" })
        .getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("marks the current destination with aria-current", async () => {
    vi.mocked(usePathname).mockReturnValue("/print");
    render(<MobileNav initialUnreadCount={0} />);

    await openMenu();

    const printLink = screen.getByRole("link", { name: /^Print$/ });
    expect(printLink.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByRole("link", { name: /^Materials$/ }).getAttribute("aria-current")
    ).toBeNull();
  });

  it("badges Print with the cart count and Notifications with unread", async () => {
    mockCartCount = 3;
    render(<MobileNav initialUnreadCount={7} />);

    await openMenu();

    expect(screen.getByLabelText("3 in cart").textContent).toBe("3");
    expect(screen.getByLabelText("7 unread").textContent).toBe("7");
  });

  it("gives anon visitors a sign-in row and no inbox", async () => {
    mockUser = null;
    render(<MobileNav initialUnreadCount={0} />);

    await openMenu();

    const menu = screen.getByRole("navigation", { name: "Primary" });
    expect(
      Array.from(menu.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    ).toEqual(["/", "/files", "/print", "/materials"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(openAuth).toHaveBeenCalledWith("sign-in");
  });

  it("appends the owner-only Text-to-CAD destination when enabled", async () => {
    render(<MobileNav initialUnreadCount={0} textToCad />);

    await openMenu();

    expect(screen.getByRole("link", { name: /Prometheus/ })).toBeTruthy();
  });
});
