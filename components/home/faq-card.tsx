"use client";

import { Plus } from "@/components/icons/plus";
import { cn } from "@/lib/utils";

/**
 * One FAQ row. Native `<details>` so the answer stays in the HTML for
 * crawlers even while collapsed; a click on the open card (not just the
 * summary) closes it. Selecting answer text does not collapse.
 */
export function FaqCard({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <details
      className={cn(
        "group/faq depth-surface rounded-2xl bg-card ring-1 ring-foreground/10",
        "transition-[box-shadow] duration-150 hover:ring-foreground/16",
        "open:cursor-pointer"
      )}
      onClick={(e) => {
        const el = e.currentTarget;
        if (!el.open) return;
        if ((e.target as Element | null)?.closest("summary")) return;
        if (typeof window !== "undefined" && window.getSelection()?.toString()) {
          return;
        }
        el.open = false;
      }}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-start gap-3 px-4 py-3.5",
          "marker:content-none [&::-webkit-details-marker]:hidden"
        )}
      >
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground/90">
          {question}
        </span>
        <span
          aria-hidden
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform duration-200 group-open/faq:rotate-45"
        >
          <Plus size={12} />
        </span>
      </summary>
      <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
        {answer}
      </p>
    </details>
  );
}
