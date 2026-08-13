import type { SVGProps } from "react";

/**
 * Tray + downward-arrow download glyph. 2px round-cap stroke; uses
 * currentColor so callers recolor via text-* classes.
 */
export function Download({
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
      <path
        d="M12 4v11M8.5 11.5L12 15l3.5-3.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 16.5V19a2 2 0 002 2h8a2 2 0 002-2v-2.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
