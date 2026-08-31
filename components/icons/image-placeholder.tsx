import type { SVGProps } from "react";

/**
 * Cute chunky image glyph — thick rounded frame, sun, and soft hills.
 * currentColor so callers recolor via text-* classes.
 */
export function ImagePlaceholder({
  size = 40,
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
        x="2.75"
        y="2.75"
        width="18.5"
        height="18.5"
        rx="5.5"
        stroke="currentColor"
        strokeWidth="2.75"
      />
      <circle cx="9" cy="9.25" r="2.2" fill="currentColor" />
      <path
        fill="currentColor"
        d="M5.1 18.15 8.45 13.7a1.25 1.25 0 0 1 1.95 0l1.2 1.55 2.55-3.45a1.25 1.25 0 0 1 2.05 0l3.2 4.35c.35.48 0 1.2-.65 1.2H5.75c-.6 0-.95-.68-.65-1.2Z"
      />
    </svg>
  );
}
