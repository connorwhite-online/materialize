import type { SVGProps } from "react";

/**
 * Hole: material with a bore through it. The surrounding plate is what
 * separates this from a plain circle — a hole is defined by the thing it is
 * cut into, so the glyph shows both.
 */
export function HoleOp({
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
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
