import type { SVGProps } from "react";

/**
 * Thick, slightly rounded chevron pointing down. Matches
 * chevron-right.tsx's stroke + corner style so the icon family
 * reads consistently.
 */
export function ChevronDown({
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
      <path d="M6 9 L10 13 Q12 15 14 13 L18 9" />
    </svg>
  );
}
