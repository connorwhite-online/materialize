import { CreativeCommons, Scale } from "lucide-react";
import { getLicenseMeta } from "@/lib/licenses";
import { cn } from "@/lib/utils";

interface Props {
  /** Raw license id from the row (new CC id or a legacy value). */
  license: string | null | undefined;
  /**
   * "full" (default) — pill with the CC glyph + short name + full
   *   name, e.g. "CC-BY · Attribution". Used under a listing title.
   * "compact" — pill with just the short name, for tight rows.
   */
  size?: "full" | "compact";
  className?: string;
}

/**
 * Shared license chip for file + project listings. Renders the license
 * as a tasteful pill linking to the canonical Creative Commons deed,
 * with the full terms as the hover title. Returns null for genuinely
 * unknown license values so callers don't have to null-check.
 *
 * This replaced the ad-hoc `License: cc_by` text and the bare inline
 * link that used to live on each detail page — keep new license
 * surfaces routed through here so the styling stays consistent.
 */
export function LicenseBadge({ license, size = "full", className }: Props) {
  const meta = getLicenseMeta(license);
  if (!meta) return null;

  return (
    <a
      href={meta.url}
      target="_blank"
      rel="noreferrer noopener"
      title={meta.summary}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
        className
      )}
    >
      {meta.id.startsWith("cc") ? (
        <CreativeCommons className="size-3.5 shrink-0 opacity-70" />
      ) : (
        <Scale className="size-3.5 shrink-0 opacity-70" />
      )}
      <span className="text-foreground">{meta.shortName}</span>
      {size === "full" && (
        <>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="font-normal">{meta.name}</span>
        </>
      )}
    </a>
  );
}
