import type { SVGProps } from "react";

/**
 * Sparkles — a large four-point star with a small companion. Marks the
 * material properties / stats / uses / benefits chip group on the
 * material detail page. Stroke inherits currentColor from text-* classes.
 */
export function Sparkles({
  size = 16,
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
        d="M9.5 3.5 11 7.8a2 2 0 0 0 1.2 1.2L16.5 10.5 12.2 12a2 2 0 0 0-1.2 1.2L9.5 17.5 8 13.2A2 2 0 0 0 6.8 12L2.5 10.5 6.8 9A2 2 0 0 0 8 7.8L9.5 3.5ZM18 14l.7 2a1 1 0 0 0 .6.6l2 .7-2 .7a1 1 0 0 0-.6.6L18 21l-.7-2a1 1 0 0 0-.6-.6L14.7 17.7l2-.7a1 1 0 0 0 .6-.6L18 14Z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
