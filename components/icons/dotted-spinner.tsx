import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Dashed ring spinner — 2px round-cap dashes on a circle, spun with
 * Tailwind's linear `animate-spin` (CSS only; respects reduced motion
 * via the global `.animate-spin` override in globals.css).
 *
 * Used by search loading and Update preview capturing (CON-36).
 */
export function DottedSpinner({
  size = 16,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("animate-spin", className)}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="5.5 4"
      />
    </svg>
  );
}
