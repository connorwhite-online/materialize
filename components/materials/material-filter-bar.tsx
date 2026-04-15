"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getMaterialCategories,
  type MaterialCategory,
  type QuickFilter,
} from "@/lib/materials";
import { QUICK_FILTER_LABELS } from "@/lib/materials/preset-library";

export function MaterialFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeCategory = searchParams.get("category") as MaterialCategory | null;
  const activeFilter = searchParams.get("filter") as QuickFilter | null;
  const categories = getMaterialCategories();

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
      // Clear the other filter type
      if (key === "category") params.delete("filter");
      if (key === "filter") params.delete("category");
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={!activeCategory && !activeFilter ? "default" : "outline"}
          size="sm"
          onClick={() => {
            const params = new URLSearchParams();
            router.push(pathname);
          }}
        >
          All
        </Button>
        {categories.map(({ category, label, count }) => (
          <Button
            key={category}
            variant={activeCategory === category ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setParam(
                "category",
                activeCategory === category ? null : category
              )
            }
          >
            {label}
            <span className="ml-1 text-xs opacity-60">{count}</span>
          </Button>
        ))}
      </div>

      {/* Quick-start filters */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center mr-1">
          Quick:
        </span>
        {(Object.entries(QUICK_FILTER_LABELS) as [QuickFilter, string][]).map(
          ([filter, label]) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? "secondary" : "ghost"}
              size="xs"
              onClick={() =>
                setParam("filter", activeFilter === filter ? null : filter)
              }
            >
              {label}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
