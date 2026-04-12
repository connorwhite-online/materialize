import type { SVGProps } from "react";

/**
 * Thick, slightly rounded chevron pointing left.
 * Mirrors `chevron-right.tsx` — same curved vertex, flipped path.
 * Uses currentColor so it inherits text color.
 */
export function ChevronLeft({
  size = 16,
  strokeWidth = 2.5,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15 6 L11 10 Q9 12 11 14 L15 18" />
    </svg>
  );
}
