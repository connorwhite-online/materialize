import type { SVGProps } from "react";

/**
 * Frame corners: four rounded L-brackets marking out a rectangle, the
 * way a viewfinder reticle does. Precedes the viewer's "Update
 * preview" label — the action reframes the shot the file is
 * represented by, so the glyph is the frame you are composing inside
 * rather than a camera body.
 */
export function FrameCorners({
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
      <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9" />
      <path d="M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9" />
      <path d="M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15" />
      <path d="M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15" />
    </svg>
  );
}
