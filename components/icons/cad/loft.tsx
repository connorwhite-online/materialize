import type { SVGProps } from "react";

/**
 * Loft: two profiles of different size with the surface blended between
 * them. The ends are drawn as real section ellipses, not flat caps — as
 * straight lines the glyph was a bare trapezoid that read as the letter A at
 * chip size. Seeing both sections is what says "blend between these two".
 */
export function LoftOp({
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
      <ellipse cx="12" cy="5.5" rx="4" ry="1.8" />
      <ellipse cx="12" cy="18" rx="7.5" ry="2.5" />
      <path d="M8 5.5 4.5 18" />
      <path d="m16 5.5 3.5 12.5" />
    </svg>
  );
}
