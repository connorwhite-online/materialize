"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Browse } from "@/components/icons/browse";
import { Materials } from "@/components/icons/materials";
import { Print } from "@/components/icons/print";
import { Galaxy } from "@/components/icons/galaxy";
import { Logomark } from "@/components/icons/logomark";
import { SidebarUserBlock } from "@/components/auth/sidebar-user-block";
import { SandboxBadge } from "@/components/nav/sandbox-badge";
import { useCart } from "@/components/print/cart-context";
import { cn } from "@/lib/utils";

import type { ComponentType, SVGProps } from "react";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/**
 * Top-level destinations for the sidebar nav (nav+). Profile isn't
 * here on purpose: the sidebar's bottom user-block IS the profile
 * link. Below the nav breakpoint the floating MobileTabBar carries
 * the same destinations as icon-only tabs.
 */
type NavItem = { href: string; label: string; Icon: NavIcon };

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/files", label: "Browse", Icon: Browse },
  { href: "/materials", label: "Materials", Icon: Materials },
  { href: "/print", label: "Print", Icon: Print },
];

// Experimental, owner-only Prometheus (text-to-CAD) entry. Only appended
// when the server resolves `canUseTextToCad` and threads `textToCad` down —
// hidden for everyone else (and the page itself 404s as a second gate).
const TEXT_TO_CAD_ITEM: NavItem = {
  href: "/prometheus",
  label: "Prometheus",
  Icon: Galaxy,
};

function navItems(textToCad: boolean): ReadonlyArray<NavItem> {
  return textToCad ? [...NAV_ITEMS, TEXT_TO_CAD_ITEM] : NAV_ITEMS;
}

/**
 * Exact-match active state. Detail pages like /files/<slug> are
 * NOT the Browse listing — they have their own h1 and the nav
 * shouldn't highlight Browse just because the URL starts with
 * /files.
 */
function isActive(pathname: string | null, href: string): boolean {
  return pathname === href;
}

// Sidebar lives in the reserved gutter the layout opens up at
// `nav:pl-56`. Below the `nav` breakpoint (1080px, defined in
// globals.css) the rail is hidden and the floating MobileTabBar
// carries the same nav. We use a custom breakpoint instead of lg so
// the rail doesn't appear until the page has enough room for both
// content + sidebar without feeling cramped.

/**
 * Floating left-rail at nav+ — a rounded card with a soft drop
 * shadow, anchored at top/left/bottom-4 in the gutter the layout
 * reserves with `nav:pl-56`. Stacks the brand wordmark, the nav
 * items, and the user-block (cart icon + avatar+username for
 * authed visitors, Sign in for anon) in one self-contained panel.
 * At nav+ the page header is hidden because everything the header
 * carried lives here now.
 */
interface MainMenuSidebarProps {
  /** Server-fetched unread notification count for the dot indicator. */
  initialUnreadCount: number;
  /** True when Stripe is on test keys or CraftCloud is in mock mode. */
  sandbox?: boolean;
  /** Owner-only: append the experimental Text-to-CAD entry. */
  textToCad?: boolean;
}

export function MainMenuSidebar({
  initialUnreadCount,
  sandbox = false,
  textToCad = false,
}: MainMenuSidebarProps) {
  const pathname = usePathname();
  const items = navItems(textToCad);
  const cart = useCart();
  const cartCount = cart?.itemCount ?? 0;

  return (
    <aside
      aria-label="Primary"
      className="fixed top-4 bottom-4 left-4 z-30 hidden w-48 flex-col rounded-2xl bg-card p-2 shadow-lg shadow-foreground/5 ring-1 ring-foreground/10 nav:flex"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <Link
          href="/"
          aria-label="Materialize — home"
          className="flex items-center px-1 py-0.5 text-foreground transition-opacity hover:opacity-80"
        >
          <Logomark height={20} />
        </Link>
        {sandbox && <SandboxBadge />}
      </div>
      <nav className="mt-3 flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const { Icon } = item;
          // Cart count pips the Print entry's icon — carts live inline
          // on /print, so there's no standalone cart button.
          const showCart = item.href === "/print" && cartCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                active
                  ? "bg-muted/60 text-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              <span className="relative inline-flex shrink-0">
                <Icon size={18} />
                {showCart && (
                  <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 py-0.5 text-center text-[0.625rem] font-semibold leading-none text-primary-foreground ring-2 ring-card">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </span>
              {item.label}
              {showCart && (
                <span className="sr-only">{cartCount} in cart</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <SidebarUserBlock initialUnreadCount={initialUnreadCount} />
      </div>
    </aside>
  );
}
