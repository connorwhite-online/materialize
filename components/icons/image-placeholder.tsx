import type { SVGProps } from "react";

/**
 * Cute chunky image glyph — sun + soft hills, no frame. currentColor
 * so callers recolor via text-* classes.
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
      <circle cx="7.75" cy="7.25" r="3.1" fill="currentColor" />
      <path
        fill="currentColor"
        d="M1.5 20.25 7.1 12.6a1.7 1.7 0 0 1 2.65 0l1.55 2.1 3.45-4.85a1.7 1.7 0 0 1 2.8 0l5 7.05c.45.65.01 1.6-.8 1.6H2.3c-.7 0-1.1-.8-.8-1.45Z"
      />
    </svg>
  );
}
