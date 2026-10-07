"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/**
 * Theme picker for the Settings tab's Appearance row: a labelled pill
 * track (same chrome as SegmentedControl) with radio semantics, since
 * it picks a value rather than switching panels. Words, not glyphs —
 * three bare icons made people hover to learn which was "System".
 */
export function AppearanceControl() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex h-9 items-center rounded-full bg-muted p-[3px]"
    >
      {OPTIONS.map((option) => {
        const active = mounted && (theme ?? "system") === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(option.value)}
            className={cn(
              "inline-flex h-full items-center rounded-full px-3 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "bg-background text-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)] dark:bg-foreground/15"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
