import type { SVGProps } from "react";

/**
 * House glyph for the Home entry in the mobile nav menu. The menu row
 * carries a "Home" text label, so it wants a category icon rather than
 * the brand mark — the logomark stands in for Home only on the
 * collapsed pill, where it appears alone.
 */
export function Home({
  size = 18,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3.5 10.6 12 3.9l8.5 6.7V19a1.6 1.6 0 0 1-1.6 1.6H5.1A1.6 1.6 0 0 1 3.5 19v-8.4Z" />
      <path d="M9.6 20.6v-5.1a2.4 2.4 0 0 1 4.8 0v5.1" />
    </svg>
  );
}
