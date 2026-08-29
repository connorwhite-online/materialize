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
import { usePathname, useRouter } from "next/navigation";

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

const routerBack = vi.fn();
const routerPush = vi.fn();

/** jsdom pins history.length at 1; most tests want "we have history". */
function setHistoryLength(length: number) {
  Object.defineProperty(window.history, "length", {
    value: length,
    configurable: true,
  });
}

beforeEach(() => {
  routerBack.mockClear();
  routerPush.mockClear();
  vi.mocked(useRouter).mockReturnValue({
    back: routerBack,
    push: routerPush,
    replace: vi.fn(),
    refresh: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
  setHistoryLength(3);
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
    expect(logo().style.getPropertyValue("--mz-h")).toBe("10px");

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
  const surface = src.match(/const NAV_SURFACE = cn\(([\s\S]*?)\n\);/)?.[1] ?? "";

  it("uses the shared glass surface", () => {
    expect(surface).toContain("glass-surface");
  });

  it("carries no bg-* utility that would beat it", () => {
    expect(surface).not.toMatch(/bg-/);
  });

  it("dresses the card and the back button from the one recipe", () => {
    // Two hand-copied class lists drift, and the back button is meant
    // to look like a piece of the card that slid out of it.
    const card =
      src.match(/"pointer-events-auto overflow-hidden[\s\S]*?\n\s*\)\}/)?.[0] ?? "";
    const backButton =
      src.match(/"pointer-events-auto absolute right-full[\s\S]*?\n\s*\)\}/)?.[0] ??
      "";
    expect(card).toContain("NAV_SURFACE");
    expect(backButton).toContain("NAV_SURFACE");
  });
});

/**
 * The ghost is a ruler, not a surface. If it animates, the card chases a
 * moving target and clips the word against its own edge — measured at
 * ~65px for ~230ms on device before this was frozen.
 */
describe("MobileNav measuring ghost", () => {
  const src = readFileSync(resolve(__dirname, "../mobile-nav.tsx"), "utf8");
  const globals = readFileSync(
    resolve(__dirname, "../../../app/globals.css"),
    "utf8"
  );

  it("freezes the ghost's lockup", () => {
    expect(src).toMatch(/className="mz-nav-ghost /);
    expect(globals).toMatch(
      /\.mz-nav-ghost \.mz-logo[\s\S]*?transition:\s*none\s*!important/
    );
  });

  it("closes the card's width and height on one shared tween", () => {
    // Filmed at 60fps: with the height on its own tween — a 240ms cubic
    // delayed 60ms so the row peel could "go soft before clipping" — the
    // card was 72% collapsed in WIDTH while its height had not moved at
    // all, peaking at an 82-point divergence. It shut sideways into a
    // letterbox and only then dropped. Matching durations is not enough;
    // two curves of the same length still trace different paths. The
    // same constant for both is the only version that cannot drift.
    // Exit may spread CARD_CROP to add an opacity soft-out — the height
    // channel must still name CARD_CROP so the crop can't drift.
    expect(src).toMatch(/open \? CARD_IN : CARD_CROP/);
    expect(src).toMatch(/\.\.\.CARD_CROP/);
    expect(src).toMatch(/opacity:\s*\{\s*duration:\s*0\.16/);
  });

  it("gives that shared close tween no delay", () => {
    const crop = src.match(/const CARD_CROP[^=]*=\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(crop).toContain("duration");
    expect(crop).not.toContain("delay");
  });

  it("tweens the collapsed card on the crop's own duration", () => {
    // The pill's width IS the lockup's width plus constant padding, so
    // these must match --mz-crop-ms or the pill lags and clips.
    const crop = Number(globals.match(/--mz-crop-ms:\s*(\d+)ms/)?.[1]);
    const card = Number(src.match(/const CARD_CROP[^=]*=\s*\{\s*duration:\s*([\d.]+)/)?.[1]);
    expect(crop).toBeGreaterThan(0);
    expect(card * 1000).toBeCloseTo(crop, 0);
    expect(src).toMatch(/open \? CARD_IN : CARD_CROP/);
  });
});

/**
 * Leaf pages have no row in the menu, so the only way out is back. The
 * button oozes out of the card's left edge — absolutely positioned, so
 * the pill never moves — and retracts anywhere the nav can already go.
 */
describe("MobileNav back button", () => {
  const back = () => screen.queryByRole("button", { name: "Go back" });

  it("stays retracted on pages the menu can reach", () => {
    for (const path of ["/", "/files", "/print", "/materials", "/notifications"]) {
      vi.mocked(usePathname).mockReturnValue(path);
      const { unmount } = render(<MobileNav initialUnreadCount={0} />);
      expect(back(), `expected no back button on ${path}`).toBeNull();
      unmount();
    }
  });

  it("stays retracted on the viewer's own profile — the identity row goes there", () => {
    vi.mocked(usePathname).mockReturnValue("/connorwhite");
    render(<MobileNav initialUnreadCount={0} />);
    expect(back()).toBeNull();
  });

  it("oozes out on a leaf page and pops history", () => {
    vi.mocked(usePathname).mockReturnValue("/files/some-widget");
    render(<MobileNav initialUnreadCount={0} />);

    const button = back();
    expect(button).toBeTruthy();
    fireEvent.click(button!);
    expect(routerBack).toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("appears on someone else's profile", () => {
    vi.mocked(usePathname).mockReturnValue("/someone-else");
    render(<MobileNav initialUnreadCount={0} />);
    expect(back()).toBeTruthy();
  });

  it("treats a destination the viewer can't see as a leaf", () => {
    // Anon has no /notifications row, and /prometheus is owner-only —
    // both are dead ends for them, so both get the way out.
    mockUser = null;
    vi.mocked(usePathname).mockReturnValue("/prometheus");
    const { unmount } = render(<MobileNav initialUnreadCount={0} />);
    expect(back()).toBeTruthy();
    unmount();

    vi.mocked(usePathname).mockReturnValue("/prometheus");
    render(<MobileNav initialUnreadCount={0} textToCad />);
    expect(back()).toBeNull();
  });

  it("falls through to the section on a cold deep link", () => {
    // Nothing of ours in the stack — popping would walk off the site.
    setHistoryLength(1);
    vi.mocked(usePathname).mockReturnValue("/files/some-widget");
    render(<MobileNav initialUnreadCount={0} />);

    fireEvent.click(back()!);
    expect(routerBack).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/files");
  });

  it("retracts while the menu is open — the menu is the way out then", async () => {
    vi.mocked(usePathname).mockReturnValue("/files/some-widget");
    render(<MobileNav initialUnreadCount={0} />);
    expect(back()).toBeTruthy();

    await openMenu();

    await waitFor(() => {
      expect(back()).toBeNull();
    });
  });
});

/**
 * The ooze itself: it must cost the card no layout (the pill is centred
 * in the viewport and must not shift), and its right corners must round
 * from square to full so it reads as sliding out of the card rather
 * than fading in beside it.
 */
describe("MobileNav back button ooze", () => {
  const src = readFileSync(resolve(__dirname, "../mobile-nav.tsx"), "utf8");
  const button =
    src.match(/key="back"[\s\S]*?<\/motion\.button>/)?.[0] ?? "";

  it("is positioned absolutely against the card, so nothing reflows", () => {
    expect(button).toContain("absolute right-full");
    expect(button).toContain("marginRight: BACK_GAP");
  });

  it("rounds only the right corners, from 0 to half the height", () => {
    expect(button).toMatch(/initial=\{\{[\s\S]*?borderTopRightRadius: 0/);
    expect(button).toMatch(/initial=\{\{[\s\S]*?borderBottomRightRadius: 0/);
    expect(button).toMatch(
      /animate=\{\{[\s\S]*?borderTopRightRadius: BACK_SIZE \/ 2/
    );
    expect(button).toMatch(
      /animate=\{\{[\s\S]*?borderBottomRightRadius: BACK_SIZE \/ 2/
    );
    // The left pair is a static half-height, set inline rather than via
    // `rounded-l-full`: Tailwind's infinite radius makes CSS scale EVERY
    // corner down when the edge overruns, which crushed the animated
    // right pair to ~0 and settled the button as a hard vertical cut.
    expect(button).toContain("borderTopLeftRadius: BACK_SIZE / 2");
    expect(button).toContain("borderBottomLeftRadius: BACK_SIZE / 2");
    // As a class-list token — the comment beside the style block names
    // it deliberately, to say why it must not come back.
    expect(button).not.toMatch(/"[^"\n]*rounded-l-full/);
  });

  it("settles 8px clear of the card", () => {
    expect(src).toMatch(/const BACK_GAP = 8;/);
  });

  it("clips the glyph as it grows instead of squashing it", () => {
    expect(button).toContain("overflow-hidden");
  });
});

/**
 * Timing. Nothing else in this navigation animates — the page swaps in
 * one frame and so does the pill's title — so the chip is the only
 * thing the eye can catch trailing, and the numbers below are what
 * keep it from doing that. All three came off 60fps captures: an
 * iPhone recording of the shipped build, then a rAF-sampled harness
 * driving the real component.
 */
describe("MobileNav back button timing", () => {
  const src = readFileSync(resolve(__dirname, "../mobile-nav.tsx"), "utf8");
  const num = (name: string, field: string) =>
    Number(
      src
        .match(new RegExp(`const ${name}[^=]*=\\s*\\{([^}]*)\\}`))?.[1]
        .match(new RegExp(`${field}:\\s*([\\d.]+)`))?.[1]
    );
  const ease = (name: string) =>
    src.match(new RegExp(`const ${name}[^=]*=\\s*\\{[^}]*ease:\\s*(\\[[^\\]]*\\])`))?.[1];

  it("lands inside the card's own morph", () => {
    // The chip is one 44px element, not a container. Filmed at 320ms it
    // was still creeping ~200ms after the page and the title had cut.
    const cardIn = num("CARD_IN", "duration");
    expect(cardIn).toBeGreaterThan(0);
    expect(num("BACK_OOZE_IN", "duration")).toBeLessThanOrEqual(cardIn);
    expect(num("BACK_OOZE_OUT", "duration")).toBeLessThan(
      num("BACK_OOZE_IN", "duration")
    );
  });

  it("does not use the card's expo-out, which has no visible start", () => {
    // `[0.22, 1, 0.36, 1]` spends ~20% of the width in its first frame,
    // so the chip appeared already detached and the ooze never read.
    const expo = ease("CARD_IN");
    expect(expo).toBe("[0.22, 1, 0.36, 1]");
    expect(ease("BACK_OOZE_IN")).not.toBe(expo);
  });

  it("lands the glyph before the chip stops growing", () => {
    // An empty white disc holding for the last frames reads as a
    // missing icon, not as content arriving behind its container.
    expect(num("BACK_GLYPH_IN", "delay") + num("BACK_GLYPH_IN", "duration"))
      .toBeLessThanOrEqual(num("BACK_OOZE_IN", "duration"));
  });
});

/**
 * Open/close used to hard-cut: the scrim mounted with a classed
 * `backdrop-blur` (iOS ignores opacity on backdrop-filter, so the
 * page snapped soft), and the pill ↔ user identity swapped on
 * opacity alone. Both now tween opacity with blur so the menu
 * materialises rather than pops.
 */
describe("MobileNav open/close fade", () => {
  const src = readFileSync(resolve(__dirname, "../mobile-nav.tsx"), "utf8");

  it("tweens the scrim's blur as a numeric CSS variable", () => {
    // String `backdropFilter: "blur(Npx)"` does not interpolate
    // reliably in Motion — the radius snapped while only opacity
    // faded. A unitless var + `calc(... * 1px)` is what eases.
    expect(src).toMatch(/const SCRIM_BLUR_PX = \d+/);
    expect(src).toMatch(/const SCRIM_BLUR_VAR = "--mz-scrim-blur"/);
    expect(src).toMatch(
      /backdropFilter:\s*`blur\(calc\(var\(\$\{SCRIM_BLUR_VAR\}, 0\) \* 1px\)\)`/
    );
    expect(src).toMatch(/WebkitBackdropFilter/);
    expect(src).toMatch(/\[SCRIM_BLUR_VAR\]:\s*SCRIM_BLUR_PX/);
    expect(src).toMatch(/\[SCRIM_BLUR_VAR\]:\s*0/);
    // Always mounted — unmounting via AnimatePresence remounted the
    // filter at full strength even when the radius tween looked right.
    expect(src).toMatch(/pointerEvents:\s*open \? "auto" : "none"/);
    // A static Tailwind blur fights the tweened radius.
    expect(src).not.toMatch(/backdrop-blur-\[/);
  });

  it("uses a readable ease, not the card's front-loaded expo-out", () => {
    // The card's `[0.22, 1, 0.36, 1]` dumps most of the travel in the
    // first frames — fine for a morphing pill, fatal for a fade that
    // has to read as a fade. Scrim duration can exceed CARD_IN; the
    // ease must not match CARD_IN's.
    const cardEase = src.match(
      /const CARD_IN[^=]*=\s*\{[^}]*ease:\s*(\[[^\]]*\])/
    )?.[1];
    const scrimEase = src.match(
      /const SCRIM_EASE\s*=\s*(\[[^\]]*\])/
    )?.[1];
    expect(cardEase).toBe("[0.22, 1, 0.36, 1]");
    expect(scrimEase).toBeTruthy();
    expect(scrimEase).not.toBe(cardEase);
    const scrimIn = Number(
      src.match(/const SCRIM_IN[^=]*=\s*\{\s*duration:\s*([\d.]+)/)?.[1]
    );
    expect(scrimIn).toBeGreaterThanOrEqual(0.35);
  });

  it("crossfades the identity with blur, not opacity alone", () => {
    expect(src).toMatch(/filter:\s*"blur\(6px\)"/);
    expect(src).toMatch(/filter:\s*"blur\(0px\)"/);
    // Both the open user-container and the closed page-pill.
    const identityBlurIns = src.match(/filter:\s*"blur\(6px\)"/g) ?? [];
    expect(identityBlurIns.length).toBeGreaterThanOrEqual(2);
  });

  it("materialises menu rows with opacity and blur", () => {
    expect(src).toMatch(/ITEM_VARIANTS[\s\S]*filter:\s*"blur\(10px\)"/);
    expect(src).toMatch(/ITEM_VARIANTS[\s\S]*filter:\s*"blur\(0px\)"/);
    expect(src).toMatch(/function rowExit[\s\S]*filter:\s*"blur\(10px\)"/);
  });
});
