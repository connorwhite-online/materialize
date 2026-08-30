import { EyeIcon, EyeOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Frosted eye-off chip for minimal card wells (library file/project
 * tiles). Icon-only — the detail-page OwnerBar carries the word.
 */
export function PrivateCardMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-black/55 p-1 text-white backdrop-blur-md ring-1 ring-white/10",
        className
      )}
      aria-label="Private"
      title="Private"
    >
      <EyeOffIcon className="size-3" aria-hidden="true" />
    </span>
  );
}

/**
 * Eye / eye-off glyph paired with a Public/Private label. Used by
 * OwnerBar on file, project, and collection detail pages.
 */
export function VisibilityLabelIcon({
  visibility,
  className,
}: {
  visibility: "public" | "private";
  className?: string;
}) {
  const Icon = visibility === "public" ? EyeIcon : EyeOffIcon;
  return <Icon className={cn("size-3.5 shrink-0", className)} aria-hidden="true" />;
}
