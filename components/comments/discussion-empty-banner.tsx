import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Signed-in: expands the composer. */
  onStart?: () => void;
  /** Signed-out: banner links here instead of expanding. */
  signInHref?: string;
};

/**
 * Compact empty-state for Discussion when there are no comments or
 * photo posts yet — and the viewer is not the owner. Soft green
 * wash + chunky chat icon; owners never see this (their empty
 * Discussion section is omitted entirely).
 */
export function DiscussionEmptyBanner({
  className,
  onStart,
  signInHref,
}: Props) {
  const content = (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
        aria-hidden="true"
      >
        <MessageCircleIcon className="size-5" strokeWidth={2.4} absoluteStrokeWidth />
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Share your build!
      </span>
    </>
  );

  const classes = cn(
    "flex w-full items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-center transition-[background-color,box-shadow]",
    "bg-gradient-to-r from-emerald-50/70 via-muted/40 to-teal-50/50",
    "shadow-sm ring-1 ring-emerald-900/[0.06]",
    "dark:from-emerald-950/35 dark:via-muted/20 dark:to-teal-950/30",
    "dark:ring-emerald-100/[0.06]",
    "hover:shadow-md hover:ring-emerald-900/10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "dark:hover:ring-emerald-100/10",
    className
  );

  if (signInHref) {
    return (
      <Link href={signInHref} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(classes, "cursor-pointer")}
    >
      {content}
    </button>
  );
}
