import type { SVGProps } from "react";

/**
 * Tiny surprised face — 2px round-cap stroke. Used as the "oops"
 * mark next to empty search results.
 */
export function Oops({
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
      <circle cx="9.25" cy="10.25" r="1.15" fill="currentColor" />
      <circle cx="14.75" cy="10.25" r="1.15" fill="currentColor" />
      <circle
        cx="12"
        cy="14.75"
        r="1.6"
        stroke="currentColor"
        strokeWidth={2}
      />
    </svg>
  );
}
