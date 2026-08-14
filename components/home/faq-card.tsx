"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Plus } from "@/components/icons/plus";
import {
  EASE_OUT_SOFT,
  SPRING,
  SPRING_CLOSE,
  SPRING_SETTLE,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * One FAQ row. The answer stays mounted (height 0 when closed) so the
 * FAQPage copy is always in the DOM. Open: the card springs to height
 * and the answer materialises — a short lift plus a blur that resolves
 * as it lands, same recipe as the mobile-nav rows. Close: critically
 * damped so height never overshoots past 0. Clicking the open card
 * (not just the question) collapses it; selecting answer text does not.
 */
export function FaqCard({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const snap = reducedMotion ? { duration: 0 } : null;

  return (
    <div
      className={cn(
        "group/faq depth-surface rounded-2xl bg-card ring-1 ring-foreground/10",
        "transition-[box-shadow] duration-150 ease-spring hover:ring-foreground/16",
        open && "cursor-pointer"
      )}
      onClick={(e) => {
        if (!open) return;
        if ((e.target as Element | null)?.closest("button")) return;
        if (typeof window !== "undefined" && window.getSelection()?.toString()) {
          return;
        }
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground/90">
          {question}
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 45 : 0 }}
          transition={snap ?? SPRING}
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Plus size={12} />
        </motion.span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0 }}
        transition={snap ?? (open ? SPRING : SPRING_CLOSE)}
        className="overflow-hidden"
      >
        <motion.p
          initial={false}
          animate={
            open
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: 8, filter: "blur(6px)" }
          }
          transition={
            snap ??
            (open
              ? {
                  y: SPRING_SETTLE,
                  opacity: { duration: 0.22, ease: EASE_OUT_SOFT },
                  filter: { duration: 0.28, ease: EASE_OUT_SOFT },
                }
              : { duration: 0.15, ease: "easeIn" })
          }
          className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground"
        >
          {answer}
        </motion.p>
      </motion.div>
    </div>
  );
}
