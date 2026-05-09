"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "@/components/icons/chevron-right";

interface Props {
  title: string;
  /** Optional badge / count next to the title (e.g. item counts). */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Generic collapsible section: chevron-button header that animates a
 * 90° rotation and expands/collapses its body with a height tween.
 * Mirrors the visual pattern used on the materials catalog accordion
 * and profile collection sections.
 */
export function CollapsibleSection({
  title,
  meta,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full cursor-pointer items-center gap-2 text-left outline-none"
        aria-expanded={open}
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        >
          <ChevronRight size={16} />
        </motion.span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {meta !== undefined && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {meta}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
