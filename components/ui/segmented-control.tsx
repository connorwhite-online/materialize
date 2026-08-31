"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type SegmentedControlItem<T extends string = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string = string> = {
  items: Array<SegmentedControlItem<T>>;
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  className?: string;
  /** Extra classes on the muted track (`TabsList`). */
  listClassName?: string;
};

/**
 * Global segmented control — the pill-track chrome used across the app
 * (project pages, owner settings, …). Built on `@/components/ui/tabs`
 * (`bg-muted` track + active `bg-background` pill).
 *
 * Use this when selection drives URL or parent state and panels live
 * outside the control. For in-place panels under the same root, compose
 * `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` directly (see
 * `ProjectTabs`).
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
  listClassName,
}: SegmentedControlProps<T>) {
  return (
    <Tabs
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (typeof next !== "string") return;
        onValueChange?.(next as T);
      }}
      className={className}
    >
      <TabsList className={cn("w-full justify-start", listClassName)}>
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
