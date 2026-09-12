import type { SVGProps } from "react";

/**
 * Extrude: an isometric profile face with an arrow lifting off it — the
 * sketch and the direction it is pushed, which is the whole operation.
 * The face is drawn as a diamond (a square in isometric) so the set reads
 * as 3D construction rather than 2D shapes.
 */
export function ExtrudeOp({
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
      <path d="M12 20 4 16l8-4 8 4-8 4Z" />
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
    </svg>
  );
}
