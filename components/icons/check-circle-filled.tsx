import type { SVGProps } from "react";

/**
 * Filled check circle — solid disc with a round-cap check stroked in
 * `--background` so it reads as a cutout on both light and dark
 * translucent chips (Update preview "saved", etc.).
 */
export function CheckCircleFilled({
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
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="m8.5 12.25 2.5 2.5 5-5.5"
        stroke="var(--background)"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
