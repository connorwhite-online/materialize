import type { SVGProps } from "react";

/**
 * Play — a softened triangle. Same stroke language as the chevrons: thick, round
 * caps and joins, currentColor.
 */
export function Play({
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
      <path d="M8.5 6.8 Q8.5 5.6 9.6 6.2 L17.2 11 Q18.2 12 17.2 13 L9.6 17.8 Q8.5 18.4 8.5 17.2 Z" />
    </svg>
  );
}
