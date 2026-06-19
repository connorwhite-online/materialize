"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ShoppingCartIcon, CircleUserRound } from "lucide-react";
import { Browse } from "@/components/icons/browse";
import { Materials } from "@/components/icons/materials";
import { Print } from "@/components/icons/print";
import { Wand } from "@/components/icons/wand";
import { AvatarWithUnreadDot } from "@/components/auth/avatar-with-unread-dot";
import { SandboxBadge } from "@/components/nav/sandbox-badge";
import { useCart } from "@/components/print/cart-context";
import { useAuthModal } from "@/components/auth/auth-modal";
import { cn } from "@/lib/utils";

import type { ComponentType, SVGProps } from "react";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/**
 * Primary destinations rendered as icon-only tabs in the floating
 * bottom bar (sub-nav viewports). Mirrors the sidebar's NAV_ITEMS at
 * nav+; Profile is handled separately because it renders the user's
 * avatar (or a sign-in affordance for anon) rather than a glyph.
 */
type TabItem = { href: string; label: string; Icon: NavIcon };

const TAB_ITEMS: ReadonlyArray<TabItem> = [
  { href: "/files", label: "Browse", Icon: Browse },
  { href: "/materials", label: "Materials", Icon: Materials },
  { href: "/print", label: "Print", Icon: Print },
];

// Experimental, owner-only Text-to-CAD tab. Only appended when the
// server resolves `canUseTextToCad` and threads `textToCad` down.
const TEXT_TO_CAD_ITEM: TabItem = {
  href: "/text-to-cad",
  label: "Text to CAD",
  Icon: Wand,
};

function tabItems(textToCad: boolean): ReadonlyArray<TabItem> {
  return textToCad ? [...TAB_ITEMS, TEXT_TO_CAD_ITEM] : TAB_ITEMS;
}

/**
 * Exact-match active state — same rule as the sidebar. Detail pages
 * like /files/<slug> are NOT the Browse listing, so we don't highlight
 * Browse just because the path starts with /files.
 */
function isActive(pathname: string | null, href: string): boolean {
  return pathname === href;
}

const TAB_BASE =
  "relative flex h-12 w-12 items-center justify-center rounded-full transition-colors";

interface MobileTabBarProps {
  /** Server-fetched unread notification count for the dot indicator. */
  initialUnreadCount: number;
  /** Owner-only: append the experimental Text-to-CAD tab. */
  textToCad?: boolean;
  /** True when Stripe is on test keys or CraftCloud is in mock mode. */
  sandbox?: boolean;
}

/**
 * App-like bottom navigation for sub-nav viewports (hidden at nav+,
 * where the floating sidebar rail takes over). Icon-only tabs sit in
 * a translucent, blurred, rounded pill anchored to the bottom of the
 * screen; the cart rides in a separate pill to the right and only
 * appears when there's something in it.
 *
 * Replaces the old dropdown "page-title + caret" trigger that lived in
 * the mobile header — primary nav is now a persistent, thumb-reachable
 * bar instead of a nested menu.
 */
export function MobileTabBar({
  initialUnreadCount,
  textToCad = false,
  sandbox = false,
}: MobileTabBarProps) {
  const pathname = usePathname();
  const { user, isLoaded, isSignedIn } = useUser();
  const { openAuth } = useAuthModal();
  const cart = useCart();
  const items = tabItems(textToCad);

  const ownProfilePath =
    isLoaded && user?.username ? `/${user.username}` : null;
  const profileActive =
    !!ownProfilePath && pathname === ownProfilePath;

  return (
    // pointer-events-none on the wrapper so the area beside the pills
    // stays click-through to page content; each pill re-enables it.
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex items-center justify-center gap-2 px-4 nav:hidden">
      <nav
        aria-label="Primary"
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-[1.75rem] p-1.5",
          "bg-muted/70 backdrop-blur-xl dark:bg-input/40",
          "shadow-lg shadow-foreground/10 ring-1 ring-foreground/10"
        )}
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const { Icon } = item;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                TAB_BASE,
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={24} />
            </Link>
          );
        })}

        {/* Profile — avatar for authed users, sign-in affordance for
            anon. Lives at the end of the pill (matches the app-nav
            convention of profile sitting last/rightmost). */}
        {isSignedIn && user ? (
          <Link
            href={ownProfilePath ?? "/"}
            aria-label="Your profile"
            aria-current={profileActive ? "page" : undefined}
            className={cn(
              TAB_BASE,
              profileActive
                ? "bg-background shadow-sm"
                : "hover:bg-background/60"
            )}
          >
            {/* Inner relative wrapper so the sandbox badge anchors to the
                avatar's corner, not the (larger) tap-target button. */}
            <span className="relative inline-flex">
              <AvatarWithUnreadDot
                initialUnreadCount={initialUnreadCount}
                seed={user.username || user.id}
                imageUrl={user.hasImage ? user.imageUrl : null}
                displayName={
                  user.fullName ||
                  user.username ||
                  user.primaryEmailAddress?.emailAddress ||
                  "Profile"
                }
                className="h-7 w-7"
              />
              {sandbox && (
                <SandboxBadge className="absolute -right-1.5 -top-1.5 z-10 p-0.5 ring-2 ring-muted dark:ring-input" />
              )}
            </span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => openAuth("sign-in")}
            aria-label="Sign in"
            // Reserve the slot before Clerk resolves so the bar doesn't
            // reflow when the avatar swaps in for a signed-in user.
            className={cn(
              TAB_BASE,
              "text-muted-foreground hover:text-foreground",
              !isLoaded && "opacity-0"
            )}
          >
            <span className="relative inline-flex">
              <CircleUserRound size={24} strokeWidth={1.75} />
              {sandbox && (
                <SandboxBadge className="absolute -right-2 -top-2 z-10 p-0.5 ring-2 ring-muted dark:ring-input" />
              )}
            </span>
          </button>
        )}
      </nav>

      {/* Cart — a separate pill to the right of the nav, shown only
          when there's something in it, with a count badge. */}
      {cart && cart.itemCount > 0 && (
        <button
          type="button"
          onClick={cart.open}
          aria-label={`Cart (${cart.itemCount} ${
            cart.itemCount === 1 ? "item" : "items"
          })`}
          className={cn(
            "pointer-events-auto relative flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-[1.75rem]",
            "bg-muted/70 backdrop-blur-xl dark:bg-input/40",
            "shadow-lg shadow-foreground/10 ring-1 ring-foreground/10",
            "text-foreground transition-colors hover:bg-muted"
          )}
        >
          <ShoppingCartIcon className="h-6 w-6" />
          <span className="absolute right-1 top-1 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-primary-foreground ring-2 ring-muted">
            {cart.itemCount > 99 ? "99+" : cart.itemCount}
          </span>
        </button>
      )}
    </div>
  );
}
