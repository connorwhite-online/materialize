"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/categories";

/**
 * Horizontal category chips for /files. Toggling a chip sets / clears
 * the `?category=` param while preserving any active `?q=` search, so
 * "search within a category" and "just browse a category" are the
 * same control. Mirrors the URL-state approach of MaterialFilterBar.
 */
export function CategoryFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const active = searchParams.get("category");

  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set("category", id);
    else params.delete("category");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Button
        variant={!active ? "default" : "outline"}
        size="sm"
        className="shrink-0"
        onClick={() => select(null)}
      >
        All
      </Button>
      {CATEGORIES.map((c) => (
        <Button
          key={c.id}
          variant={active === c.id ? "default" : "outline"}
          size="sm"
          className="shrink-0"
          onClick={() => select(active === c.id ? null : c.id)}
        >
          {c.label}
        </Button>
      ))}
    </div>
  );
}
