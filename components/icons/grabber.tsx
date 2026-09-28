import type { SVGProps } from "react";

/**
 * Grabber: two stacked chevrons, open ends facing — a pull handle — that
 * fold into an X when the menu opens.
 *
 * The four chevron arms are the X's four half-diagonals: each arm is one
 * short stroke centred on the origin, placed by translate + rotate, so
 * the morph is a pure CSS transform transition (a `d` transition would
 * skip Safari). Each arm swings 90° about its own centre to become the
 * half of the X nearest it.
 */
const HALF = 3.25; // half an arm's length, viewBox units

// [closed, open] — centre x, centre y, angle (deg; SVG y points down).
const ARMS: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [
  [[9.7, 7.2, -45], [9.75, 9.75, 45]], // top chevron, left arm  → \ top
  [[14.3, 7.2, 45], [14.25, 9.75, -45]], // top chevron, right arm → / top
  [[9.7, 16.8, 45], [9.75, 14.25, -45]], // bottom, left arm       → / bottom
  [[14.3, 16.8, -45], [14.25, 14.25, 45]], // bottom, right arm    → \ bottom
];

export function Grabber({
  size = 18,
  strokeWidth = 2,
  open = false,
  ...props
}: SVGProps<SVGSVGElement> & {
  size?: number;
  strokeWidth?: number;
  /** Menu expanded — shows the X; collapsed shows the handle. */
  open?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      {ARMS.map(([closed, opened], i) => {
        const [x, y, a] = open ? opened : closed;
        return (
          <line
            key={i}
            x1={-HALF}
            x2={HALF}
            y1={0}
            y2={0}
            className="transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              transformBox: "view-box",
              transformOrigin: "0 0",
              transform: `translate(${x}px, ${y}px) rotate(${a}deg)`,
            }}
          />
        );
      })}
    </svg>
  );
}
