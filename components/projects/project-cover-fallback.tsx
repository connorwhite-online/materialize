import Link from "next/link";
import { Logomark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * On-brand stand-in for a project cover when there is no image to show:
 * no cover photo, no legacy thumbnail and no bundled-file art. A project
 * with no files at all (boards, wiring, code) lands here by default, so
 * it has to look intentional rather than empty. The mark paints with
 * currentColor, so it follows the theme.
 *
 * `addCoverHref` is passed for editors only; it turns the caption into a
 * link to the photo uploader so the way to add a cover is on the cover.
 */
export function ProjectCoverFallback({
  size = "lg",
  addCoverHref,
  className,
}: {
  size?: "sm" | "lg";
  addCoverHref?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-muted to-muted/50",
        className
      )}
      role="img"
      aria-label="No cover image"
    >
      <Logomark
        height={size === "lg" ? 44 : 22}
        className="text-muted-foreground/30"
      />
      {addCoverHref && (
        <Link
          href={addCoverHref}
          className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Add a cover photo
        </Link>
      )}
    </div>
  );
}
