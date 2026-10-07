interface LibrarySectionProps {
  name: string;
  /** Count shown in the header pill. */
  count: number;
  /**
   * Singular noun for the accessible label ("File" → "3 Files").
   * Not shown in the chip — the heading already names the section.
   */
  countNoun: string;
  /** Kept for callers; section titles are text-only per the rulebook. */
  icon?: React.ReactNode;
  /** Smaller heading for the authed-home column. */
  compact?: boolean;
  children: React.ReactNode;
}

/**
 * Static section for the profile Library view — heading + count pill
 * above a horizontal carousel. Matches {@link CollectionSection}'s
 * header treatment without the collection-specific settings/visibility
 * chrome.
 */
export function LibrarySection({
  name,
  count,
  countNoun,
  compact = false,
  children,
}: LibrarySectionProps) {
  const countAria =
    count === 0
      ? `Empty ${name.toLowerCase()}`
      : `${count} ${count === 1 ? countNoun : `${countNoun}s`}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2
          className={
            compact
              ? "min-w-0 truncate text-sm leading-5 font-semibold"
              : "min-w-0 truncate text-base leading-6 font-semibold"
          }
        >
          {name}
        </h2>
        <span
          aria-label={countAria}
          className="shrink-0 text-sm text-subtle-foreground tabular-nums"
        >
          {count === 0 ? "Empty" : count}
        </span>
      </div>
      {children}
    </section>
  );
}
