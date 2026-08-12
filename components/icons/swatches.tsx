import type { SVGProps } from "react";

/**
 * Overlapping rounded cards — Materials in the desktop top bar.
 * Uses currentColor so it inherits stroke from text-* classes.
 */
export function Swatches({
  size = 18,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect
        x="3.5"
        y="8.5"
        width="11"
        height="12"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={2}
      />
      <rect
        x="9.5"
        y="3.5"
        width="11"
        height="12"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={2}
      />
    </svg>
  );
}
