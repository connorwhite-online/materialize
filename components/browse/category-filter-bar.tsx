"use client";

import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "@/lib/categories";

/**
 * Horizontal category chips for /files. Toggling a chip sets / clears
 * the `?category=` param while preserving any active `?q=` search, so
 * "search within a category" and "just browse a category" are the
 * same control. Mirrors the URL-state approach of MaterialFilterBar.
 *
 * Chips are Links inside a <nav> so AT announces the landmark and chips
 * work without JS. The active chip's href drops ?category so clicking
 * it again toggles the filter off (same behavior as the previous Button
 * onClick implementation).
 */
export function CategoryFilterBar() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const active = searchParams.get("category");

  /** Build the href for a chip. Preserves ?q but sets/clears ?category. */
  const hrefFor = (id: string | null): string => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set("category", id);
    else params.delete("category");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const chipClass = (isActive: boolean) =>
    cn(
      "inline-flex shrink-0 items-center justify-center rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      isActive
        ? "bg-primary text-primary-foreground depth-raised-on-dark"
        : "border border-input bg-background depth-raised hover:bg-accent hover:text-accent-foreground"
    );

  return (
    <nav
      aria-label="Categories"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Link
        href={hrefFor(null)}
        className={chipClass(!active)}
        aria-current={!active ? "true" : undefined}
      >
        All
      </Link>
      {CATEGORIES.map((c) => {
        const isActive = active === c.id;
        // Active chip href drops ?category — clicking it toggles off
        const href = isActive ? hrefFor(null) : hrefFor(c.id);
        return (
          <Link
            key={c.id}
            href={href}
            className={chipClass(isActive)}
            aria-current={isActive ? "true" : undefined}
          >
            {c.label}
          </Link>
        );
      })}
    </nav>
  );
}
