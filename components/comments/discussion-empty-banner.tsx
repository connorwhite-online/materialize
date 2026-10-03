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
 * photo posts yet — and the viewer is not the owner. Reads like a
 * composer you haven't typed into yet (ChatGPT's prompt-row shape): a
 * flat soft-gray row, glyph and invitation on the left, the action on
 * the right. Owners never see this (their empty Discussion section is
 * omitted entirely).
 */
export function DiscussionEmptyBanner({
  className,
  onStart,
  signInHref,
}: Props) {
  const content = (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-background text-foreground ring-1 ring-border"
        aria-hidden="true"
      >
        <MessageCircleIcon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold text-foreground">
          Share your build
        </span>
        <span className="block text-sm text-muted-foreground">
          Post a photo or tell people how it printed.
        </span>
      </span>
    </>
  );

  const classes = cn(
    "flex w-full items-center gap-3 rounded-2xl bg-muted/70 px-4 py-3 transition-colors duration-150",
    "hover:bg-muted",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
