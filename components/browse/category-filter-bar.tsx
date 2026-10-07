"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

/**
 * Category chips for /files: one horizontally scrolling row of pills
 * (Shop / YouTube style) that drives the `?category=` URL param while
 * preserving any active `?q=` search. Every chip is a real link, so the
 * shelves are crawlable and middle-click opens them in a tab; the page
 * server-renders from the param, so nothing here holds state.
 *
 * It replaced a lone "All categories" Select: a dropdown hides the
 * taxonomy behind a click, and the taxonomy is the thing browsing is
 * for. On mount the active chip is scrolled into view, so a deep link
 * to a late category doesn't land with its own chip off-screen.
 */
export function CategoryFilterBar({
  active,
  query,
}: {
  /** Active category slug, or "" for all. */
  active: string;
  /** Active text query, carried through so a chip refines the search. */
  query?: string;
}) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const el = activeRef.current;
    if (!el || !active) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const hrefFor = (category: string) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    const qs = params.toString();
    return qs ? `/files?${qs}` : "/files";
  };

  const chips = [{ id: "", label: "All" }, ...CATEGORIES];

  return (
    <nav
      aria-label="Categories"
      className="-mx-4 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-32px),transparent)] sm:mx-0 sm:[mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]"
    >
      <ul className="flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => {
          const isActive = c.id === active;
          return (
            <li key={c.id || "all"} className="shrink-0">
              <Link
                ref={isActive ? activeRef : undefined}
                href={hrefFor(c.id)}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={cn(
                  "inline-flex h-8 items-center rounded-full px-3.5 text-sm whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  isActive
                    ? "bg-foreground font-medium text-background"
                    : "bg-secondary text-foreground hover:bg-foreground/[0.09]"
                )}
              >
                {c.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
