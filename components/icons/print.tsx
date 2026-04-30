import type { SVGProps } from "react";

/**
 * Cube icon used to mark the Print nav entry. Three visible faces
 * meeting at a center vertex to read as 3D-printable geometry.
 * Uses currentColor so it inherits stroke color from text-* classes.
 */
export function Print({
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
        d="M12.0002 12L4.5 7.78123M12.0002 12L12 20.5M12.0002 12L19.5 7.78123M20 8.08484V15.9151C20 16.2764 19.8051 16.6096 19.4903 16.7867L12.4903 20.7242C12.1858 20.8955 11.8142 20.8955 11.5097 20.7242L4.50974 16.7867C4.19486 16.6096 4 16.2764 4 15.9151V8.08484C4 7.72357 4.19486 7.39038 4.50974 7.21326L11.5097 3.27576C11.8142 3.10453 12.1858 3.10453 12.4903 3.27576L19.4903 7.21326C19.8051 7.39038 20 7.72357 20 8.08484Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
