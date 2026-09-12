import type { SVGProps } from "react";

/**
 * Generic operation: a plain isometric solid, used for the sidecar's
 * `"other"` bucket and for any op a future sidecar emits that this set has
 * no glyph for yet. Deliberately the most neutral shape in the set — it
 * should read as "a step happened here", not as a specific operation.
 */
export function GenericOp({
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
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
      <path d="m12 12 8.5-5" />
      <path d="M12 12v9.5" />
      <path d="M12 12 3.5 7" />
    </svg>
  );
}
