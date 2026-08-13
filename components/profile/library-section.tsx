import { Badge } from "@/components/ui/badge";

interface LibrarySectionProps {
  name: string;
  /** Count shown in the header pill (e.g. number of files/projects). */
  count: number;
  /** Singular/plural noun for the count pill ("File" → "3 Files"). */
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
  const countLabel =
    count === 0
      ? "Empty"
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
        <Badge variant="outline" className="ml-4 h-6 shrink-0 px-2.5">
          {countLabel}
        </Badge>
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}
