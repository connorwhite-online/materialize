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
 * photo posts yet. A short green gradient banner with a chunky chat
 * icon — much lighter than the always-on composer chrome.
 */
export function DiscussionEmptyBanner({
  className,
  onStart,
  signInHref,
}: Props) {
  const content = (
    <>
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/55 text-emerald-800 shadow-sm ring-1 ring-emerald-900/10 backdrop-blur-sm dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-100/10"
        aria-hidden="true"
      >
        <MessageCircleIcon className="size-6" strokeWidth={2.6} absoluteStrokeWidth />
      </span>
      <span className="text-base font-semibold tracking-tight text-emerald-950 dark:text-emerald-50">
        Start the conversation!
      </span>
    </>
  );

  const classes = cn(
    "flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-5 text-center transition-[transform,box-shadow] sm:py-6",
    "bg-gradient-to-br from-emerald-100 via-teal-50 to-lime-100",
    "shadow-[0_10px_28px_-12px_rgba(6,78,59,0.45),0_4px_10px_-6px_rgba(20,83,45,0.28)]",
    "ring-1 ring-emerald-900/10",
    "dark:from-emerald-950 dark:via-teal-950/80 dark:to-lime-950/70",
    "dark:shadow-[0_12px_32px_-14px_rgba(0,0,0,0.7),0_4px_12px_-6px_rgba(16,185,129,0.18)]",
    "dark:ring-emerald-100/10",
    "hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgba(6,78,59,0.5),0_6px_14px_-6px_rgba(20,83,45,0.32)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2",
    "dark:hover:shadow-[0_16px_40px_-14px_rgba(0,0,0,0.75),0_6px_16px_-6px_rgba(16,185,129,0.25)]",
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
    <button type="button" onClick={onStart} className={cn(classes, "cursor-pointer")}>
      {content}
    </button>
  );
}
