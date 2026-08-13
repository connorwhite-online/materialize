import type { SVGProps } from "react";

/**
 * Grabber: a chevron pointing up stacked over a chevron pointing down,
 * open ends facing each other. Marks a surface you can pull open — the
 * mobile nav's collapsed pill uses it the way a sheet uses a grab
 * handle, and it reads the same in both states, so it doesn't rotate.
 */
export function Grabber({
  size = 18,
  strokeWidth = 2,
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
      <path d="M7.4 10.1 11.3 6.2a1 1 0 0 1 1.4 0l3.9 3.9" />
      <path d="M7.4 13.9l3.9 3.9a1 1 0 0 0 1.4 0l3.9-3.9" />
    </svg>
  );
}
