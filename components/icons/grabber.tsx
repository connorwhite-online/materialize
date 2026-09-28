"use client";

import type { SVGProps } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Grabber: two stacked chevrons, open ends facing — a pull handle — that
 * fold into an X when the menu opens.
 *
 * Drawn like the rest of the chevron family (chevron-down.tsx and
 * siblings): straight arms into a soft quadratic tip, round caps and
 * joins. Each chevron is ONE path with the same command structure in
 * both states (M L Q L), so motion can tween its `d` directly — CSS `d`
 * transitions skip Safari. Open, each chevron flips to a V whose soft tip
 * meets the other's at the centre: together, an X. (An earlier version
 * built it from four straight strokes, which lost the family's soft tip.)
 */
const TOP = {
  closed: "M7 10 L10.6 6.4 Q12 5 13.4 6.4 L17 10",
  open: "M6.5 6.5 L10.9 10.9 Q12 12 13.1 10.9 L17.5 6.5",
};
const BOTTOM = {
  closed: "M7 14 L10.6 17.6 Q12 19 13.4 17.6 L17 14",
  open: "M6.5 17.5 L10.9 13.1 Q12 12 13.1 13.1 L17.5 17.5",
};

export function Grabber({
  size = 18,
  strokeWidth = 2,
  open = false,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number;
  strokeWidth?: number;
  /** Menu expanded — shows the X; collapsed shows the handle. */
  open?: boolean;
}) {
  const reduced = useReducedMotion();
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };
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
      <motion.path
        initial={false}
        animate={{ d: open ? TOP.open : TOP.closed }}
        transition={transition}
      />
      <motion.path
        initial={false}
        animate={{ d: open ? BOTTOM.open : BOTTOM.closed }}
        transition={transition}
      />
    </svg>
  );
}
