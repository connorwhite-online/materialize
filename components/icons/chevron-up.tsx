import type { SVGProps } from "react";

/**
 * Thick, slightly rounded chevron pointing up. Mirror of
 * chevron-down.tsx.
 */
export function ChevronUp({
  size = 16,
  strokeWidth = 2.5,
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
      <path d="M6 15 L10 11 Q12 9 14 11 L18 15" />
    </svg>
  );
}
