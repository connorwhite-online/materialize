import type { SVGProps } from "react";

/**
 * Boolean: two overlapping solids. Squares rather than circles — a Venn
 * diagram reads as set theory, while two offset bodies read as the CAD
 * operation of combining or cutting one solid with another.
 */
export function BooleanOp({
  size = 16,
  strokeWidth = 2,
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
      <rect x="4" y="4" width="11" height="11" rx="2" />
      <rect x="9" y="9" width="11" height="11" rx="2" />
    </svg>
  );
}
