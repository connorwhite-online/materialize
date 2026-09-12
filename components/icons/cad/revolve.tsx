import type { SVGProps } from "react";

/**
 * Revolve: a sweep arrow turning about a ghosted axis. Two earlier passes
 * were wrong in ways only rendering showed — drawing the profile too made
 * the mark collide into an illegible blob at 16px, and a full-height axis
 * line crossed the sweep at top and bottom. So the profile is gone and the
 * axis is a short centre stub the arc never touches.
 *
 * The arc's own path ENDS at the arrowhead's corner (20, 8.4) rather than
 * near it; an arrowhead merely placed close to an arc reads as detached.
 */
export function RevolveOp({
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
      <path d="M12 7.5v9" strokeDasharray="2 2" opacity={0.55} />
      <path d="M20 12a8 8 0 1 1-8-8c2.24 0 4.38.89 5.99 2.44L20 8.4" />
      <path d="M20 8.4V4h-4.4" />
    </svg>
  );
}
