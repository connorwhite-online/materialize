// @vitest-environment jsdom
/**
 * Behaviour of the morphing mobile nav: the collapsed pill names the
 * current page, tapping it discloses the destination menu plus the
 * user container, and anon visitors get a Login button instead of an
 * inbox they can't read.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("wears the viewer's face and handle on their own profile", () => {
    vi.mocked(usePathname).mockReturnValue("/connorwhite");
    render(<MobileNav initialUnreadCount={0} />);

    // The handle replaces the word "Profile" in the pill…
    expect(trigger().textContent).toContain("@connorwhite");
    expect(trigger().textContent).not.toContain("Profile");
    // …but the button is still named for assistive tech.
    expect(trigger().getAttribute("aria-label")).toBe(
      "Profile — open navigation menu"
    );
  });

  it("falls back to the icon + title on someone else's profile", () => {
    vi.mocked(usePathname).mockReturnValue("/someone-else");
    render(<MobileNav initialUnreadCount={0} />);

    expect(trigger().textContent).not.toContain("@connorwhite");
    expect(trigger().getAttribute("aria-label")).toBe(
      "Menu — open navigation menu"
    );
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

  it("collapses the destinations when the grabber is tapped again", async () => {
    render(<MobileNav initialUnreadCount={0} />);

    await openMenu();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    });

    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
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

  it("gives anon visitors a Login button and no inbox", async () => {
    mockUser = null;
    render(<MobileNav initialUnreadCount={0} />);

    await openMenu();

    const menu = screen.getByRole("navigation", { name: "Primary" });
    expect(
      Array.from(menu.querySelectorAll("a")).map((a) => a.getAttribute("href"))
    ).toEqual(["/", "/files", "/print", "/materials"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Login" }));
    });
    expect(openAuth).toHaveBeenCalledWith("sign-in");
  });

  it("appends the owner-only Text-to-CAD destination when enabled", async () => {
    render(<MobileNav initialUnreadCount={0} textToCad />);

    await openMenu();

    expect(screen.getByRole("link", { name: /Prometheus/ })).toBeTruthy();
  });
});

/** Same scroll shim the top-bar spec uses; useScrolled reads window.scrollY. */
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

/**
 * The anon home pill carries the full animated lockup, not the bare
 * mark — the same wipe-in and scroll-collapse the desktop nav makes.
 * Signed-in home keeps the mark: that pill sits over a dashboard.
 */
describe("MobileNav brand lockup", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/");
    setScrollY(0);
  });

  it("wipes the lockup in on anon home, then peels it to the mark", () => {
    mockUser = null;
    render(<MobileNav initialUnreadCount={0} />);
    const logo = () => document.querySelector(".mz-logo") as HTMLElement;

    expect(logo()).toBeTruthy();
    // Unset `expanded` is what puts it in mount mode — see
    // useWordmarkExpanded. A boolean here would skip the reveal.
    expect(logo().dataset.mzMode).toBe("mount");
    expect(logo().style.getPropertyValue("--mz-h")).toBe("12px");

    setScrollY(40);
    expect(logo().dataset.mzMode).toBe("toggle");
    expect(logo().dataset.mzExpanded).toBe("false");

    setScrollY(0);
    expect(logo().dataset.mzExpanded).toBe("true");

    // Still just the mark for assistive tech — the lockup is decorative
    // and the button keeps naming the page.
    expect(trigger().getAttribute("aria-label")).toBe(
      "Home — open navigation menu"
    );
  });

  it("keeps the bare mark for signed-in home", () => {
    mockUser = {
      id: "user_1",
      username: "connorwhite",
      fullName: "Connor White",
      hasImage: false,
      imageUrl: "",
      primaryEmailAddress: { emailAddress: "connor@example.com" },
    };
    render(<MobileNav initialUnreadCount={0} />);
    expect(document.querySelector(".mz-logo")).toBeNull();
  });

  it("leaves other pages' pills alone", () => {
    mockUser = null;
    vi.mocked(usePathname).mockReturnValue("/files");
    render(<MobileNav initialUnreadCount={0} />);
    expect(document.querySelector(".mz-logo")).toBeNull();
    expect(trigger().textContent).toContain("Search");
  });
});

/**
 * The card wears the design system's frosted fill. Pinned at source
 * level because the failure is silent: `.glass-surface` lives in
 * `@layer components`, so ANY `bg-*` utility beside it wins and the
 * card goes opaque with no error and no failing render.
 */
describe("MobileNav card surface", () => {
  const src = readFileSync(resolve(__dirname, "../mobile-nav.tsx"), "utf8");
  const cardClasses =
    src.match(/"pointer-events-auto overflow-hidden[\s\S]*?\n\s*\)\}/)?.[0] ?? "";

  it("uses the shared glass surface", () => {
    expect(cardClasses).toContain("glass-surface");
  });

  it("carries no bg-* utility that would beat it", () => {
    expect(cardClasses).not.toMatch(/"bg-|\sbg-[a-z]/);
  });
});
