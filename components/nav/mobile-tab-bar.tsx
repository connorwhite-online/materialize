"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { CircleUserRound } from "lucide-react";
import { Browse } from "@/components/icons/browse";
import { Materials } from "@/components/icons/materials";
import { Print } from "@/components/icons/print";
import { Galaxy } from "@/components/icons/galaxy";
import { UserAvatar } from "@/components/auth/user-avatar";
import { NotificationsPopover } from "@/components/nav/notifications-popover";
import { SandboxBadge } from "@/components/nav/sandbox-badge";
import { useCart } from "@/components/print/cart-context";
import { useAuthModal } from "@/components/auth/auth-modal";
import { useKeyboardOpen } from "@/lib/hooks/use-keyboard-sticky-bottom";
import { cn } from "@/lib/utils";

import type { ComponentType, SVGProps } from "react";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/**
 * Primary destinations rendered as icon-only tabs in the floating
 * bottom bar (sub-nav viewports). Mirrors the desktop top bar's
 * destinations at nav+; Profile is handled separately because it
 * renders the user's avatar (or a sign-in affordance for anon)
 * rather than a glyph.
 */
type TabItem = { href: string; label: string; Icon: NavIcon };

const TAB_ITEMS: ReadonlyArray<TabItem> = [
  { href: "/files", label: "Browse", Icon: Browse },
  { href: "/materials", label: "Materials", Icon: Materials },
  { href: "/print", label: "Print", Icon: Print },
];

// Experimental, owner-only Prometheus (text-to-CAD) tab. Only appended when
// the server resolves `canUseTextToCad` and threads `textToCad` down.
const TEXT_TO_CAD_ITEM: TabItem = {
  href: "/prometheus",
  label: "Prometheus",
  Icon: Galaxy,
};

function tabItems(textToCad: boolean): ReadonlyArray<TabItem> {
  return textToCad ? [...TAB_ITEMS, TEXT_TO_CAD_ITEM] : TAB_ITEMS;
}

/**
 * Exact-match active state — same rule as the desktop top bar. Detail
 * pages like /files/<slug> are NOT the Browse listing, so we don't
 * highlight Browse just because the path starts with /files.
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
 * where the desktop top bar takes over). Icon-only tabs sit in
 * a translucent, blurred, rounded pill anchored to the bottom of the
 * screen. There's no separate cart button: carts live inline on the
 * /print page, so a count badge pips the Print tab instead.
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
  // Fade the pill out while the soft keyboard is up so it doesn't float over a
  // raised text field (e.g. the studio composer, MTR-212). Global: any focused
  // input that opens the keyboard on a sub-nav viewport gets the clean hide.
  // The transition is CSS opacity/translate; `motion-reduce` drops it to an
  // instant toggle for prefers-reduced-motion (Accessibility).
  const keyboardOpen = useKeyboardOpen();

  const ownProfilePath =
    isLoaded && user?.username ? `/${user.username}` : null;
  const profileActive =
    !!ownProfilePath && pathname === ownProfilePath;
  const cartCount = cart?.itemCount ?? 0;

  return (
    // pointer-events-none on the wrapper so the area beside the nav
    // stays click-through to page content; the nav re-enables it.
    <div
      aria-hidden={keyboardOpen || undefined}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-40 flex items-center justify-center px-4 nav:hidden",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        keyboardOpen && "translate-y-6 opacity-0"
      )}
    >
      <nav
        aria-label="Primary"
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full p-1.5",
          // Un-tappable while faded out so it can't intercept taps meant for
          // the raised input under it.
          keyboardOpen ? "pointer-events-none" : "pointer-events-auto",
          "bg-muted/70 backdrop-blur-xl dark:bg-input/40",
          "shadow-lg shadow-foreground/10 ring-1 ring-foreground/10"
        )}
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const { Icon } = item;
          // Cart count pips the Print tab — tapping through surfaces the
          // carts inline on /print, so there's no standalone cart button.
          const showCart = item.href === "/print" && cartCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={
                showCart ? `${item.label} (${cartCount} in cart)` : item.label
              }
              aria-current={active ? "page" : undefined}
              className={cn(
                TAB_BASE,
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={24} />
              {showCart && (
                <span className="absolute right-1 top-1 min-w-[1.125rem] rounded-full bg-primary px-1 py-0.5 text-center text-[0.625rem] font-semibold leading-none text-primary-foreground ring-2 ring-muted dark:ring-input">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Link>
          );
        })}

        {/* Profile — avatar for authed users, sign-in affordance for
            anon. Lives at the end of the pill (matches the app-nav
            convention of profile sitting last/rightmost). */}
        {isSignedIn && user ? (
          <>
            <NotificationsPopover
              initialUnreadCount={initialUnreadCount}
              side="top"
              align="end"
              triggerClassName={cn(
                TAB_BASE,
                "text-muted-foreground hover:text-foreground"
              )}
              dotClassName="absolute right-1 top-1 h-2 w-2 rounded-[999px] bg-primary ring-2 ring-muted dark:ring-input"
            />
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
              <span className="relative inline-flex">
                <UserAvatar
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
          </>
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
    </div>
  );
}
