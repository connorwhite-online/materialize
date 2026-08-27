import { Badge } from "@/components/ui/badge";

interface LibrarySectionProps {
  name: string;
  /** Count shown in the header pill. */
  count: number;
  /**
   * Singular noun for the accessible label ("File" → "3 Files").
   * Not shown in the chip — the heading already names the section.
   */
  countNoun: string;
  /** Empty-library glyph prepended to the heading (box / layers). */
  icon: React.ReactNode;
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
  icon,
  compact = false,
  children,
}: LibrarySectionProps) {
  const countAria =
    count === 0
      ? `Empty ${name.toLowerCase()}`
      : `${count} ${count === 1 ? countNoun : `${countNoun}s`}`;

  return (
    <section>
      <div className="flex w-full items-center gap-2 text-muted-foreground">
        <span className="flex shrink-0">{icon}</span>
        <h2
          className={
            compact
              ? "min-w-0 truncate text-sm font-semibold"
              : "min-w-0 truncate text-lg font-semibold"
          }
        >
          {name}
        </h2>
        <Badge
          variant="outline"
          aria-label={countAria}
          className="ml-3 h-7 min-w-7 shrink-0 px-2.5 text-sm font-semibold tabular-nums"
        >
          {count === 0 ? "Empty" : count}
        </Badge>
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}
