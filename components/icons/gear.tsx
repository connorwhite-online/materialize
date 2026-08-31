import type { SVGProps } from "react";

/**
 * Chunky filled settings gear for the notifications headline.
 * Soft 6-tooth silhouette (same family as Bell / Print) so it reads
 * cute and solid in the muted tile — not a wiry stroked outline.
 */
export function Gear({
  size = 20,
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
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.01 5.29 Q9.22 2.60 10.68 2.29 A9.80 9.80 0 0 1 13.32 2.29 Q14.78 2.60 13.99 5.29 A7.00 7.00 0 0 1 16.82 6.92 Q18.75 4.89 19.75 6.00 A9.80 9.80 0 0 1 21.07 8.29 Q21.53 9.71 18.81 10.37 A7.00 7.00 0 0 1 18.81 13.63 Q21.53 14.29 21.07 15.71 A9.80 9.80 0 0 1 19.75 18.00 Q18.75 19.11 16.82 17.08 A7.00 7.00 0 0 1 13.99 18.71 Q14.78 21.40 13.32 21.71 A9.80 9.80 0 0 1 10.68 21.71 Q9.22 21.40 10.01 18.71 A7.00 7.00 0 0 1 7.18 17.08 Q5.25 19.11 4.25 18.00 A9.80 9.80 0 0 1 2.93 15.71 Q2.47 14.29 5.19 13.63 A7.00 7.00 0 0 1 5.19 10.37 Q2.47 9.71 2.93 8.29 A9.80 9.80 0 0 1 4.25 6.00 Q5.25 4.89 7.18 6.92 A7.00 7.00 0 0 1 10.01 5.29 Z M15.50 12.00 A3.50 3.50 0 1 0 8.50 12.00 A3.50 3.50 0 1 0 15.50 12.00 Z"
        fill="currentColor"
      />
    </svg>
  );
}
