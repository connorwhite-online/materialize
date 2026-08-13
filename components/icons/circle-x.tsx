import type { SVGProps } from "react";

/**
 * Chubby circled X — 2px round-cap stroke, X inset from the rim so
 * it reads as a little close chip rather than a thin glyph.
 */
export function CircleX({
  size = 16,
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
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth={2}
      />
      <path
        d="M9.4 9.4L14.6 14.6M14.6 9.4L9.4 14.6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
