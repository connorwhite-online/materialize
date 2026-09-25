import type { SVGProps } from "react";

/**
 * Pause — two rounded bars. Same stroke language as the chevrons: thick, round
 * caps and joins, currentColor.
 */
export function Pause({
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
      <path d="M9 6.5 V17.5 M15 6.5 V17.5" />
    </svg>
  );
}
