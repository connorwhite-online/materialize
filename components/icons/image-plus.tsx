import type { SVGProps } from "react";

/**
 * Image-plus icon — a picture frame with a small "+" mark in the
 * top-right corner, used on the photo uploader's drop target.
 * Stroked style; currentColor so callers recolor via text-* classes.
 */
export function ImagePlus({
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
      <path
        d="M21 12V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H12"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 16L8 11L13 16L17 12L21 16"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 3V9M15 6H21"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
