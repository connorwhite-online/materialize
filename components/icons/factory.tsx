import type { SVGProps } from "react";

/**
 * Factory silhouette — chimney stack, awning-style roof, and a
 * stepped right wing. Used on the vendor selection cards to
 * represent a manufacturing partner. Uses currentColor so it
 * inherits text color from its container.
 */
export function Factory({
  size = 24,
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
      <path d="M5.86073 8.8356C5.9411 8.35341 6.35829 8 6.84713 8H9.15287C9.64171 8 10.0589 8.35341 10.1393 8.8356L12 20H4L5.86073 8.8356Z" />
      <path d="M19 3H10C8.89543 3 8 3.89543 8 5" />
      <path d="M15 14V11.4985C15 11.0867 14.5302 10.8515 14.2005 11.0981L10.9219 13.5508L12 20H20V11.4603C20 11.0558 19.5447 10.8188 19.2133 11.0507L15 14Z" />
    </svg>
  );
}
