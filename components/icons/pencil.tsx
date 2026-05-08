import type { SVGProps } from "react";

/**
 * Pencil/edit icon. Stroked style; uses currentColor so callers
 * recolor via text-* classes.
 */
export function Pencil({
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
        d="M18 10.5L7.79289 20.7071C7.60536 20.8946 7.351 21 7.08579 21H4C3.44772 21 3 20.5523 3 20V16.9142C3 16.649 3.10536 16.3946 3.29289 16.2071L13.5 5.99997L15.7929 3.70708C16.1834 3.31655 16.8166 3.31655 17.2071 3.70708L20.2929 6.79286C20.6834 7.18339 20.6834 7.81655 20.2929 8.20708L18 10.5ZM13.5 5.99997L18 10.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
