import type { SVGProps } from "react";

/**
 * Fillet: a solid with one corner rounded off, and the sharp corner it
 * replaced ghosted in behind. Drawn as a closed body rather than an open L —
 * as strokes, a fillet and a chamfer are the same elbow with a two-pixel
 * difference at 16px, whereas two silhouettes read apart instantly.
 * Deliberately the same composition as ChamferOp; only the corner differs.
 */
export function FilletOp({
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
      <path d="M10.5 4.5H19.5V19.5H4.5V10.5A6 6 0 0 1 10.5 4.5Z" />
      <path d="M4.5 10.5v-6h6" strokeDasharray="2 2" opacity={0.55} />
    </svg>
  );
}
