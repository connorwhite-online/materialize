import type { SVGProps } from "react";

/**
 * Thick, slightly rounded chevron pointing right.
 * strokeLinecap + strokeLinejoin = "round" for soft corners.
 * Uses currentColor so it inherits text color.
 */
export function ChevronRight({
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
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
