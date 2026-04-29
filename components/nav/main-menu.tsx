"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MenuExpand } from "@/components/icons/menu-expand";
import { cn } from "@/lib/utils";

/**
 * Top-level destinations the main nav exposes. Single source of
 * truth for both the inline-trigger dropdown (small viewports) and
 * the left sidebar (>= 2xl). Add a row here and it shows up in both
 * places.
 *
 * The icon next to the logo is the "expand" caret-pair the design
 * brief specified (components/icons/menu-expand.tsx).
 */
const NAV_ITEMS = [
  { href: "/files", label: "Browse" },
  { href: "/materials", label: "Materials" },
  { href: "/print", label: "Print" },
] as const;

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
 * Compact dropdown trigger that sits next to the logo. Hidden at
 * 1700px+ where the sidebar takes over.
 */
export function MainMenuTrigger() {
  const pathname = usePathname();
  return (
    <div className="min-[1700px]:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open menu"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MenuExpand size={18} />
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
 * Fixed left rail visible only at the sidebar breakpoint and up.
 * Anchored just below the 56-px (h-14) header so it shares vertical
 * space with the page content but stays clear of the top bar.
 * Width is 12rem (w-48) — narrow enough to fit in the side margin
 * around max-w-7xl with a ~16px gap to content at 1700-1728px
 * viewports, generous beyond that.
 */
export function MainMenuSidebar() {
  const pathname = usePathname();
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
      </nav>
    </aside>
  );
}
