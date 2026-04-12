"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Badge } from "@/components/ui/badge";

interface CollectionSectionProps {
  name: string;
  description?: string | null;
  visibility: "public" | "private" | string;
  showVisibilityBadge: boolean;
  fileCount: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Collapsible wrapper for a collection section in the profile Library view.
 * Header is a button (chevron + name), right-aligned visibility chip.
 * Files outside a collection are rendered in their own non-collapsible
 * grid elsewhere.
 */
export function CollectionSection({
  name,
  description,
  visibility,
  showVisibilityBadge,
  fileCount,
  defaultOpen = true,
  children,
}: CollectionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const countLabel =
    fileCount === 0
      ? "Empty"
      : `${fileCount} ${fileCount === 1 ? "File" : "Files"}`;

  return (
    <section className="rounded-2xl bg-muted/50 p-5">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
          aria-expanded={open}
        >
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          >
            <ChevronRight size={16} />
          </motion.span>
          <h2 className="min-w-0 truncate text-lg font-semibold">{name}</h2>
          <Badge
            variant="outline"
            className="ml-4 h-6 shrink-0 px-2.5"
          >
            {countLabel}
          </Badge>
        </button>
        {showVisibilityBadge && (
          <Badge
            variant="outline"
            className="h-6 shrink-0 px-2.5 capitalize"
          >
            {visibility}
          </Badge>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              {description && (
                <p className="mb-4 text-xs text-muted-foreground">
                  {description}
                </p>
              )}
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
