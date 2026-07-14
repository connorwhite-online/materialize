"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Badge } from "@/components/ui/badge";

interface LibrarySectionProps {
  name: string;
  /** Count shown in the header pill (e.g. number of files/projects). */
  count: number;
  /** Singular/plural noun for the count pill ("File" → "3 Files"). */
  countNoun: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Generic collapsible section for the profile Library view. Mirrors the
 * header/chevron/count-pill treatment of {@link CollectionSection} so
 * Files and Projects read as the same kind of collapsible section as
 * Collections, without the collection-specific settings/visibility chrome.
 */
export function LibrarySection({
  name,
  count,
  countNoun,
  defaultOpen = true,
  children,
}: LibrarySectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const countLabel =
    count === 0
      ? "Empty"
      : `${count} ${count === 1 ? countNoun : `${countNoun}s`}`;

  return (
    <section className="rounded-2xl bg-muted/50 p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 text-left cursor-pointer"
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
        <Badge variant="outline" className="ml-4 h-6 shrink-0 px-2.5">
          {countLabel}
        </Badge>
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
            <div className="pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
