"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Appearance</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          System matches your device.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5"
      >
        {OPTIONS.map((option) => {
          const isActive = mounted && theme === option.value;
          const Icon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={option.label}
              title={option.label}
              onClick={() => setTheme(option.value)}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}
