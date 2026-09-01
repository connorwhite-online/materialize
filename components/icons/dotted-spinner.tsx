import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Dotted ring spinner — 2px round-cap dots on a circle, spun with
 * Tailwind's linear `animate-spin` (CSS only; respects reduced motion
 * via the global `.animate-spin` override in globals.css).
 *
 * `strokeDasharray="0 6.5"` with round caps collapses each dash to a
 * dot; the gap keeps them evenly spaced so the ring reads as dotted
 * rather than dashed (search loading + Update preview capturing).
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
        strokeDasharray="0 6.5"
      />
    </svg>
  );
}
