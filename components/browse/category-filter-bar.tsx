"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES } from "@/lib/categories";

const ALL = "__all__";

/**
 * Category filter for /files — a single Select that drives the
 * `?category=` URL param (preserving any active `?q=` search), mirroring
 * the material-family Select on the Materials page. Server-rendered
 * /files reads the param to filter its queries, so changing the select
 * navigates rather than just flipping client state.
 */
export function CategoryFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const active = searchParams.get("category") ?? ALL;

  const onChange = (value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (!value || value === ALL) params.delete("category");
    else params.set("category", value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <Select value={active} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="min-w-48"
        aria-label="Filter by category"
      >
        <SelectValue>
          {(value) =>
            value === ALL || value == null
              ? "All categories"
              : (CATEGORIES.find((c) => c.id === value)?.label ??
                "All categories")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All categories</SelectItem>
        {CATEGORIES.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
