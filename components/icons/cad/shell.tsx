import type { SVGProps } from "react";

/**
 * Shell: a solid hollowed out to a wall thickness, drawn open-topped so the
 * wall itself is visible as the gap between the outer and inner profiles.
 * A closed box with an inset box would read as "layers"; the open top is
 * what says the inside was removed.
 */
export function ShellOp({
  size = 16,
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
      <path d="M4 4v16h16V4" />
      <path d="M8 4v12h8V4" />
    </svg>
  );
}
