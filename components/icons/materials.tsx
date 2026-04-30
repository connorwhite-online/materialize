import type { SVGProps } from "react";

/**
 * Bucket-with-pour icon used to mark the Materials nav entry.
 * Uses currentColor so it inherits stroke color from text-* classes.
 */
export function Materials({
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
        d="M7.4 16.5H7.6M11.3958 18.7499L17.6458 7.92462C17.9219 7.44633 17.7581 6.83474 17.2798 6.55859L12.4993 3.79859M11.0001 19.6742L20.5734 14.147C21.0517 13.8709 21.2156 13.2593 20.9395 12.781L18.1791 8M12 16.5V4C12 3.44772 11.5523 3 11 3H4C3.44772 3 3 3.44772 3 4V16.5C3 18.9853 5.01472 21 7.5 21C9.98528 21 12 18.9853 12 16.5ZM8 16.5C8 16.7761 7.77614 17 7.5 17C7.22386 17 7 16.7761 7 16.5C7 16.2239 7.22386 16 7.5 16C7.77614 16 8 16.2239 8 16.5Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
