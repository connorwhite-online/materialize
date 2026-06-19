"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MenuExpand } from "@/components/icons/menu-expand";
import { Browse } from "@/components/icons/browse";
import { Materials } from "@/components/icons/materials";
import { Print } from "@/components/icons/print";
import { Wand } from "@/components/icons/wand";
import { SidebarUserBlock } from "@/components/auth/sidebar-user-block";
import { SandboxBadge } from "@/components/nav/sandbox-badge";
import { cn } from "@/lib/utils";

import type { ComponentType, SVGProps } from "react";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/**
 * Top-level destinations shown in both the dropdown trigger menu
 * (sub-lg) and the sidebar nav (lg+). Profile isn't here on purpose:
 * the sidebar's bottom user-block IS the profile link, and the
 * dropdown's hit-target is the avatar in the header at sub-lg.
 */
type NavItem = { href: string; label: string; Icon: NavIcon };

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/files", label: "Browse", Icon: Browse },
  { href: "/materials", label: "Materials", Icon: Materials },
  { href: "/print", label: "Print", Icon: Print },
];

// Experimental, owner-only Text-to-CAD entry. Only appended when the
// server resolves `canUseTextToCad` and threads `textToCad` down — hidden
// for everyone else (and the page itself 404s as a second gate).
const TEXT_TO_CAD_ITEM: NavItem = {
  href: "/text-to-cad",
  label: "Text to CAD",
  Icon: Wand,
};

function navItems(textToCad: boolean): ReadonlyArray<NavItem> {
  return textToCad ? [...NAV_ITEMS, TEXT_TO_CAD_ITEM] : NAV_ITEMS;
}

/**
 * Pathname → page-label table. Only matches EXACT top-level routes —
 * detail pages like /files/<slug> or /materials/<slug> are not
 * "Browse" or "Materials" listings, they have their own h1 and the
 * trigger should fall back to the wordmark there.
 */
const PAGE_LABELS: Record<string, string> = {
  "/files": "Browse",
  "/materials": "Materials",
  "/print": "Print",
  "/dashboard": "Dashboard",
  "/collections": "Collections",
  "/projects": "Projects",
};

/**
 * Resolve the trigger button's text. Returning `null` means "show
 * the brand wordmark instead" — used for the user's own profile
 * (their authed home), every detail page, and any path that
 * isn't one of the top-level destinations above.
 */
function getPageLabel(
  pathname: string | null,
  ownProfilePath: string | null
): string | null {
  if (!pathname) return null;
  if (ownProfilePath && pathname === ownProfilePath) return null;
  return PAGE_LABELS[pathname] ?? null;
}

/**
 * Exact-match active state. Detail pages like /files/<slug> are
 * NOT the Browse listing — they have their own h1 and the nav
 * shouldn't highlight Browse just because the URL starts with
 * /files. Same rule as getPageLabel above so the trigger label
 * and the nav highlight always agree on what "active" means.
 */
function isActive(pathname: string | null, href: string): boolean {
  return pathname === href;
}

// Sidebar lives in the reserved gutter the layout opens up at
// `nav:pl-56`. Below the `nav` breakpoint (1080px, defined in
// globals.css) the rail is hidden and the dropdown trigger in
// the header carries the same nav. We use a custom breakpoint
// instead of lg so the rail doesn't appear until the page has
// enough room for both content + sidebar without feeling cramped.

/**
 * Brand+menu trigger that occupies the left of the header on
 * sub-nav viewports. The whole [page-title text + caret] block is
 * one button — single hit-target, rounded hover bg, opens the
 * dropdown. Page title comes from `getPageLabel(pathname)` so the
 * user always sees where they are; we don't fall back to the
 * "Materialize" wordmark unless the path is genuinely unknown.
 */
export function MainMenuTrigger({
  textToCad = false,
}: {
  /** Owner-only: append the experimental Text-to-CAD entry. */
  textToCad?: boolean;
}) {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const ownProfilePath =
    isLoaded && user?.username ? `/${user.username}` : null;
  const label = getPageLabel(pathname, ownProfilePath);
  const items = navItems(textToCad);
  return (
    <div className="nav:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open menu"
          className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 leading-none transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {label === null ? (
            // Wordmark mode — own profile (authed home) and any path we
            // don't have a label for. Lowercase PP Frama Black; the DOM
            // text stays "Materialize" (a11y / SEO) and `lowercase`
            // renders it as "materialize".
            <span
              className="text-xl lowercase tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent leading-none"
              style={{
                fontFamily: "var(--font-frama-black), system-ui, sans-serif",
                fontWeight: 900,
              }}
            >
              Materialize
            </span>
          ) : (
            <span className="text-xl font-semibold leading-none tracking-tight text-foreground">
              {label}
            </span>
          )}
          <MenuExpand
            size={16}
            className="shrink-0 text-muted-foreground"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          // gap-0.5 = 2px between items so they're individually
          // distinguishable as rows without the visual heaviness
          // of bigger spacing.
          className="flex min-w-48 flex-col gap-0.5 p-1.5"
        >
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const { Icon } = item;
            return (
              <DropdownMenuItem
                key={item.href}
                render={<Link href={item.href} />}
                className={cn(
                  // py-1.5 (was py-2) — tightens the row height a
                  // touch while still leaving comfortable tap area
                  // on mobile.
                  "flex items-center gap-2.5 px-3 py-1.5 text-base",
                  active && "bg-muted/60 text-foreground"
                )}
              >
                <Icon size={18} className="shrink-0" />
                {item.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

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

  return (
    <aside
      aria-label="Primary"
      className="fixed top-4 bottom-4 left-4 z-30 hidden w-48 flex-col rounded-2xl bg-card p-2 shadow-lg shadow-foreground/5 ring-1 ring-foreground/10 nav:flex"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <Link
          href="/"
          className="text-xl lowercase tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent leading-none"
          style={{
            fontFamily: "var(--font-frama-black), system-ui, sans-serif",
            fontWeight: 900,
          }}
        >
          Materialize
        </Link>
        {sandbox && <SandboxBadge />}
      </div>
      <nav className="mt-3 flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const { Icon } = item;
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
              <Icon size={18} className="shrink-0" />
              {item.label}
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
