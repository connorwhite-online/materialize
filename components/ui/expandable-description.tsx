"use client";

import { useState, useRef, useEffect } from "react";
import { MarkdownProse } from "./markdown-prose";
import { cn } from "@/lib/utils";

interface Props {
  source: string;
  /**
   * Max-height (px) of the collapsed state. Roughly 4 body-text
   * lines at the file detail page's typography. Anything taller
   * gets a fade-out and a "Show more" toggle.
   */
  collapsedMaxHeight?: number;
}

/**
 * Inline truncate-and-expand for a markdown description. The text
 * is always markdown-rendered; we measure the rendered height and
 * if it exceeds `collapsedMaxHeight`, the body collapses behind a
 * gradient fade with a "Show more" button. No truncation of the
 * source string — that would mid-cut markdown syntax (`**bold`,
 * `[link](url`) and produce broken renders. Visual-only truncation
 * keeps the markdown intact.
 */
export function ExpandableDescription({
  source,
  collapsedMaxHeight = 110,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      setIsOverflowing(el.scrollHeight > collapsedMaxHeight + 4);
    };
    measure();
    // Re-measure on viewport changes — column width changes the
    // wrapped height of body copy.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [source, collapsedMaxHeight]);

  const collapsed = isOverflowing && !expanded;

  return (
    <div>
      <div
        className={cn("relative overflow-hidden")}
        style={
          collapsed ? { maxHeight: `${collapsedMaxHeight}px` } : undefined
        }
      >
        <div ref={innerRef}>
          <MarkdownProse>{source}</MarkdownProse>
        </div>
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>
      {isOverflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 cursor-pointer text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
