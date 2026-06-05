import type { SVGProps } from "react";

/**
 * Plus icon — a simple "+" used on add/attach actions. Stroked style;
 * currentColor so callers recolor via text-* classes.
 */
export function Plus({
  size = 18,
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
        d="M12 5V19M5 12H19"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
