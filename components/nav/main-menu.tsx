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
import { cn } from "@/lib/utils";

/**
 * Top-level destinations the dropdown exposes. The sidebar uses
 * the same list plus a Profile entry that's computed from the
 * signed-in user (since the href is dynamic per-account).
 *
 * Profile is sidebar-only on purpose: at sub-1700 widths the
 * top-right avatar already covers the same destination, and
 * doubling it in the dropdown would just add scroll on phones.
 */
const NAV_ITEMS = [
  { href: "/files", label: "Browse" },
  { href: "/materials", label: "Materials" },
  { href: "/print", label: "Print" },
] as const;

/**
 * Pathname-prefix → page-label table. Drives the "page title" the
 * trigger button displays so the user always sees where they are
 * instead of the brand wordmark on every page. Order matters —
 * first match wins, longer prefixes go first.
 */
const PAGE_LABEL_PREFIXES: Array<{ prefix: string; label: string }> = [
  { prefix: "/dashboard", label: "Dashboard" },
  { prefix: "/collections", label: "Collections" },
  { prefix: "/projects", label: "Projects" },
  { prefix: "/materials", label: "Materials" },
  { prefix: "/files", label: "Browse" },
  { prefix: "/print", label: "Print" },
  { prefix: "/u/", label: "Profile" },
];

function getPageLabel(pathname: string | null): string {
  if (!pathname) return "Materialize";
  for (const { prefix, label } of PAGE_LABEL_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) {
      return label;
    }
  }
  return "Materialize";
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // /files matches /files and /files/[slug]; root-only match for "/".
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Breakpoint math: the left rail can live entirely outside the
// centered max-w-7xl (1280px) content column when a 192px (w-48)
// sidebar plus a ~16px gap fits in the empty side margin —
// (V - 1280) / 2 ≥ 208 → V ≥ 1696. Round up to 1700 for headroom;
// below this the dropdown trigger carries the same nav. "Even
// smaller desktops" (1280–1699) explicitly stay on the dropdown per
// the design brief. The literal `min-[1700px]:` string is repeated
// inline below — Tailwind's JIT only picks up class names that
// appear verbatim in source, so we can't extract it to a constant.

/**
 * Brand+menu trigger that occupies the left of the header on
 * sub-1700 viewports. The whole [page-title text + caret] block is
 * one button — single hit-target, rounded hover bg, opens the
 * dropdown. Page title comes from `getPageLabel(pathname)` so the
 * user always sees where they are; we don't fall back to the
 * "Materialize" wordmark unless the path is genuinely unknown.
 *
 * Hidden at 1700+ — at that width the brand wordmark sits on its
 * own in the header and the sidebar carries the nav.
 */
export function MainMenuTrigger() {
  const pathname = usePathname();
  const label = getPageLabel(pathname);
  return (
    <div className="min-[1700px]:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open menu"
          className="-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xl font-semibold leading-none tracking-tight text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="leading-none">{label}</span>
          <MenuExpand
            size={16}
            className="shrink-0 text-muted-foreground"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="min-w-44 p-1"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <DropdownMenuItem
                key={item.href}
                render={<Link href={item.href} />}
                className={cn(
                  "px-2 py-1.5 text-sm",
                  active && "bg-muted/60 text-foreground"
                )}
              >
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
 * "Materialize" wordmark for the header at the sidebar breakpoint
 * and up. Below that the trigger button replaces it (and the
 * trigger's own text shows the page title). Keeps the brand
 * presence visible on widescreen layouts where the sidebar carries
 * the nav itself.
 */
export function HeaderBrand() {
  return (
    <Link
      href="/"
      className="hidden text-xl tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent leading-none min-[1700px]:inline-block"
      style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
    >
      Materialize
    </Link>
  );
}

/**
 * Fixed left rail visible only at the sidebar breakpoint and up.
 * Anchored just below the 56-px (h-14) header so it shares vertical
 * space with the page content but stays clear of the top bar.
 * Width is 12rem (w-48) — narrow enough to fit in the side margin
 * around max-w-7xl with a ~16px gap to content at 1700-1728px
 * viewports, generous beyond that.
 *
 * Profile is appended below the shared NAV_ITEMS when the user has
 * a username — this is where the avatar's destination "lives" at
 * sidebar size, replacing the redundant top-right avatar (which
 * the layout hides on the user's own profile page anyway).
 */
export function MainMenuSidebar() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const profileHref =
    isLoaded && user?.username ? `/u/${user.username}` : null;

  return (
    <aside
      aria-label="Primary"
      className="fixed top-14 left-0 z-30 hidden h-[calc(100dvh-3.5rem)] w-48 px-4 pt-8 min-[1700px]:block"
    >
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-muted/60 text-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
        {profileHref && (
          <Link
            href={profileHref}
            aria-current={isActive(pathname, profileHref) ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              isActive(pathname, profileHref)
                ? "bg-muted/60 text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            Profile
          </Link>
        )}
      </nav>
    </aside>
  );
}
