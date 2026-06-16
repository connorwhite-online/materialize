"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "@/components/icons/chevron-down";
import { cn } from "@/lib/utils";

export type ReaderChapter = {
  id: string;
  title: string;
  content: ReactNode;
};

interface Props {
  intro: ReactNode;
  chapters: ReaderChapter[];
}

/**
 * Read-side presentation of a build guide split into H2 chapters.
 * Renders the intro, a table of contents (when there's more than one
 * chapter), and each chapter as a collapsible section so a long guide
 * stays scannable. Markdown is rendered upstream and handed in as
 * `content` ReactNodes — this component only owns the disclosure + TOC.
 */
export function BuildGuideChapters({ intro, chapters }: Props) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(chapters.map((c) => c.id))
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const jumpTo = (id: string) => {
    setOpen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    requestAnimationFrame(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const allOpen = open.size === chapters.length;
  const showToc = chapters.length > 1;

  return (
    <div className="space-y-4">
      {intro && <div>{intro}</div>}

      {showToc && (
        <nav className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contents
            </span>
            <button
              type="button"
              onClick={() =>
                setOpen(
                  allOpen ? new Set() : new Set(chapters.map((c) => c.id))
                )
              }
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <ol className="space-y-0.5">
            {chapters.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(c.id)}
                  className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <span className="shrink-0 font-mono text-xs tabular-nums opacity-60">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
        {chapters.map((c) => {
          const isOpen = open.has(c.id);
          return (
            <section key={c.id} id={c.id} className="scroll-mt-20">
              <button
                type="button"
                onClick={() => toggle(c.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/60"
              >
                <ChevronDown
                  size={16}
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform",
                    !isOpen && "-rotate-90"
                  )}
                />
                <span className="text-sm font-semibold text-foreground">
                  {c.title}
                </span>
              </button>
              {isOpen && <div className="px-4 pb-4 pt-1">{c.content}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
