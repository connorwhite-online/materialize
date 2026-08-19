import { Bell } from "@/components/icons/bell";
import { Browse } from "@/components/icons/browse";
import { Galaxy } from "@/components/icons/galaxy";
import { Home } from "@/components/icons/home";
import { Layers } from "@/components/icons/layers";
import { Logomark } from "@/components/brand/logo";
import { Materials } from "@/components/icons/materials";
import { Print } from "@/components/icons/print";

import type { ComponentType, SVGProps } from "react";

/**
 * Every glyph in the nav takes the same `size` prop, including the
 * logomark (which sizes off `height` — see `iconSizeProps` below).
 */
export type NavIcon = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number; height?: number }
>;

export type NavDestination = {
  href: string;
  label: string;
  Icon: NavIcon;
  /** Hidden from anon visitors (the row needs a signed-in inbox). */
  authOnly?: boolean;
};

/**
 * Destinations listed in the expanded mobile menu, top to bottom.
 * Mirrors what the desktop top bar reaches at nav+, plus Notifications
 * — mobile has no room for the bell popover, so the inbox becomes a
 * real destination here instead.
 */
export const NAV_DESTINATIONS: ReadonlyArray<NavDestination> = [
  // The menu row is labelled, so it takes the house glyph; the brand
  // mark represents Home only on the collapsed pill, where it stands
  // alone (see resolvePageIdentity).
  { href: "/", label: "Home", Icon: Home },
  { href: "/files", label: "Search", Icon: Browse },
  { href: "/print", label: "Print", Icon: Print },
  { href: "/materials", label: "Materials", Icon: Materials },
  { href: "/notifications", label: "Notifications", Icon: Bell, authOnly: true },
];

/** Experimental, owner-only Text-to-CAD entry (same gate as the top bar). */
export const TEXT_TO_CAD_DESTINATION: NavDestination = {
  href: "/prometheus",
  label: "Prometheus",
  Icon: Galaxy,
};

export function navDestinations({
  textToCad = false,
  signedIn = false,
}: {
  textToCad?: boolean;
  signedIn?: boolean;
}): ReadonlyArray<NavDestination> {
  const base = NAV_DESTINATIONS.filter((d) => signedIn || !d.authOnly);
  return textToCad ? [...base, TEXT_TO_CAD_DESTINATION] : base;
}

/**
 * Exact-match active state — same rule as the desktop top bar. Detail
 * pages like /files/<slug> are NOT the Search listing, so we don't
 * mark Search current just because the path starts with /files.
 */
export function isDestinationActive(
  pathname: string | null,
  href: string
): boolean {
  return pathname === href;
}

export type PageIdentity = {
  label: string;
  Icon: NavIcon;
  /**
   * Render the icon alone in the collapsed pill and drop the title.
   * Only Home does this: the logomark already says "Materialize home",
   * and pairing it with the word is redundant. `label` still names the
   * pill for assistive tech.
   */
  markOnly?: boolean;
};

/**
 * What the collapsed pill says it is. Unlike `isDestinationActive`,
 * this DOES resolve section pages (a file detail page, an order, a
 * material) so the pill always names where you are rather than going
 * blank the moment you leave a top-level destination.
 *
 * Order matters: the first matching rule wins, so exact matches for
 * the menu destinations are listed ahead of their section prefixes.
 */
const IDENTITY_RULES: ReadonlyArray<{
  /** Exact path, or a section prefix matched as `<prefix>/…`. */
  path: string;
  kind: "exact" | "section";
  label: string;
  Icon: NavIcon;
  markOnly?: boolean;
}> = [
  { path: "/", kind: "exact", label: "Home", Icon: Logomark, markOnly: true },
  { path: "/files", kind: "exact", label: "Search", Icon: Browse },
  { path: "/files", kind: "section", label: "File", Icon: Browse },
  { path: "/materials", kind: "exact", label: "Materials", Icon: Materials },
  { path: "/materials", kind: "section", label: "Material", Icon: Materials },
  { path: "/print", kind: "exact", label: "Print", Icon: Print },
  { path: "/print", kind: "section", label: "Print", Icon: Print },
  {
    path: "/notifications",
    kind: "exact",
    label: "Notifications",
    Icon: Bell,
  },
  { path: "/prometheus", kind: "exact", label: "Prometheus", Icon: Galaxy },
  { path: "/prometheus", kind: "section", label: "Prometheus", Icon: Galaxy },
  { path: "/checkout", kind: "section", label: "Checkout", Icon: Print },
  { path: "/checkout", kind: "exact", label: "Checkout", Icon: Print },
  { path: "/orders", kind: "section", label: "Order", Icon: Print },
  { path: "/dashboard", kind: "exact", label: "Dashboard", Icon: Layers },
  { path: "/dashboard", kind: "section", label: "Dashboard", Icon: Layers },
  { path: "/projects", kind: "section", label: "Project", Icon: Layers },
  { path: "/collections", kind: "section", label: "Collection", Icon: Layers },
];

const FALLBACK_IDENTITY: PageIdentity = { label: "Menu", Icon: Layers };

/**
 * Resolves the collapsed pill's icon + title for a pathname.
 *
 * `ownProfilePath` is the signed-in user's `/<username>` page, which
 * can't be matched by prefix (every profile lives at the root) — pass
 * it and it wins over the fallback.
 */
export function resolvePageIdentity(
  pathname: string | null,
  ownProfilePath?: string | null
): PageIdentity {
  if (!pathname) return FALLBACK_IDENTITY;
  for (const rule of IDENTITY_RULES) {
    const hit =
      rule.kind === "exact"
        ? pathname === rule.path
        : pathname.startsWith(`${rule.path}/`);
    if (hit)
      return {
        label: rule.label,
        Icon: rule.Icon,
        ...(rule.markOnly ? { markOnly: true } : null),
      };
  }
  if (ownProfilePath && pathname === ownProfilePath) {
    return { label: "Profile", Icon: Layers };
  }
  return FALLBACK_IDENTITY;
}

/**
 * The logomark sizes off `height` (it has a wide viewBox), every other
 * glyph off `size`. Callers spread this so a single `<Icon />` call
 * site renders both kinds at the same optical size.
 */
export function iconSizeProps(
  Icon: NavIcon,
  size: number
): { size?: number; height?: number } {
  return Icon === Logomark ? { height: Math.round(size * 0.8) } : { size };
}

/**
 * Is this path somewhere the mobile nav can reach in one tap?
 *
 * The menu's rows plus the identity row (which links to the viewer's
 * own profile) are the entire surface. Anywhere else — a file detail
 * page, an order, someone else's profile — is a leaf you can only have
 * arrived at, so it earns a back button.
 *
 * Takes the same flags as `navDestinations` on purpose: /notifications
 * isn't reachable for an anon visitor and /prometheus isn't reachable
 * without the owner flag, so those pages are leaves for them too.
 */
export function isNavReachable(
  pathname: string | null,
  {
    textToCad = false,
    signedIn = false,
    ownProfilePath = null,
  }: {
    textToCad?: boolean;
    signedIn?: boolean;
    /** The signed-in viewer's `/<username>` page, if they have one. */
    ownProfilePath?: string | null;
  } = {}
): boolean {
  if (!pathname) return true;
  if (ownProfilePath && pathname === ownProfilePath) return true;
  return navDestinations({ textToCad, signedIn }).some((d) =>
    isDestinationActive(pathname, d.href)
  );
}

/**
 * Where "back" goes when there is no in-app history to pop — a shared
 * link opened cold, or a new tab. Resolves to the nav destination the
 * page sits under (`/files/<slug>` → `/files`), which is where the menu
 * would have sent them, and to home when nothing owns it.
 *
 * Deliberately ignores the auth/owner flags: this is a destination for
 * a user who is already looking at the page, not a menu row.
 */
export function backFallbackHref(pathname: string | null): string {
  if (!pathname) return "/";
  const section = [...NAV_DESTINATIONS, TEXT_TO_CAD_DESTINATION]
    .filter((d) => d.href !== "/" && pathname.startsWith(`${d.href}/`))
    // Longest prefix wins, so a nested destination beats its parent.
    .sort((a, b) => b.href.length - a.href.length)[0];
  return section?.href ?? "/";
}
