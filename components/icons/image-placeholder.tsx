import type { SVGProps } from "react";

/**
 * Classic image-placeholder glyph — chunky double hill with a circle
 * (sun) sitting above the smaller hill. Filled so it reads at empty-
 * state sizes; currentColor so callers recolor via text-* classes.
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
      {/* Sun — sits above the smaller (right) hill */}
      <circle cx="17" cy="5.75" r="2.85" fill="currentColor" />
      {/* Double hill: taller left peak, smaller right peak under the sun */}
      <path
        fill="currentColor"
        d="M1.75 19.25c0-.4.14-.78.4-1.08l4.95-5.7a2.35 2.35 0 0 1 3.55 0l.95 1.1 2.85-3.95a2.35 2.35 0 0 1 3.8.1l3.4 5.05c.45.66-.02 1.58-.9 1.58H2.55a.8.8 0 0 1-.8-.8Z"
      />
    </svg>
  );
}
