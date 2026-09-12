import type { SVGProps } from "react";

/**
 * Chamfer: a solid with one corner cut flat, and the sharp corner it
 * replaced ghosted in behind. Intentionally identical in composition to
 * FilletOp — same body, same ghost — so the only thing that differs between
 * the two chips is the thing that differs between the two operations.
 */
export function ChamferOp({
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
      <path d="M10.5 4.5H19.5V19.5H4.5V10.5Z" />
      <path d="M4.5 10.5v-6h6" strokeDasharray="2 2" opacity={0.55} />
    </svg>
  );
}
