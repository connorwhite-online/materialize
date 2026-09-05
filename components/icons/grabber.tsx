import type { SVGProps } from "react";

/**
 * Grabber: two stacked chevrons that flip between open and closed.
 * Closed: open ends face each other — a pull handle.
 * Open: tips face each other with the same center gap.
 */
export function Grabber({
  size = 18,
  strokeWidth = 2,
  open = false,
  ...props
}: SVGProps<SVGSVGElement> & {
  size?: number;
  strokeWidth?: number;
  /** Menu expanded — tips point inward; collapsed shows outward handle. */
  open?: boolean;
}) {
  const chevronTransition =
    "transition-transform duration-200 ease-out motion-reduce:transition-none";

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
      <g
        className={chevronTransition}
        style={{
          transformBox: "fill-box",
          transformOrigin: "50% 31.46%",
          transform: open
            ? "translateY(1.25px) rotate(180deg)"
            : "rotate(0deg)",
        }}
      >
        <path d="M7.4 9.5 11.3 5.6a1 1 0 0 1 1.4 0l3.9 3.9" />
      </g>
      <g
        className={chevronTransition}
        style={{
          transformBox: "fill-box",
          transformOrigin: "50% 68.54%",
          transform: open
            ? "translateY(-1.25px) rotate(180deg)"
            : "rotate(0deg)",
        }}
      >
        <path d="M7.4 14.5l3.9 3.9a1 1 0 0 0 1.4 0l3.9-3.9" />
      </g>
    </svg>
  );
}
