import type { SVGProps } from "react";

/**
 * Chunky settings gear for the notifications headline. Filled teeth +
 * hub so it reads as a soft tile icon rather than a thin outline.
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
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.06 2.75c-.42 0-.79.27-.93.66l-.4 1.13a1.6 1.6 0 0 1-1.5.99l-1.2-.14a.98.98 0 0 0-.97.48L4.3 7.8a.98.98 0 0 0 .1 1.08l.86.9a1.6 1.6 0 0 1 0 2.14l-.86.9a.98.98 0 0 0-.1 1.08l.76 1.93c.18.45.64.71 1.12.62l1.2-.14c.58-.07 1.14.24 1.4.77l.4 1.13c.14.39.51.66.93.66h1.88c.42 0 .79-.27.93-.66l.4-1.13a1.6 1.6 0 0 1 1.5-.99l1.2.14c.48.09.94-.17 1.12-.62l.76-1.93a.98.98 0 0 0-.1-1.08l-.86-.9a1.6 1.6 0 0 1 0-2.14l.86-.9a.98.98 0 0 0 .1-1.08L18.7 6.87a.98.98 0 0 0-.97-.48l-1.2.14a1.6 1.6 0 0 1-1.5-.99l-.4-1.13a.98.98 0 0 0-.93-.66h-1.88ZM12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z"
      />
    </svg>
  );
}
