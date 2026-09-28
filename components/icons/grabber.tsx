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
  // The original grabber's geometry, exactly (its a1 arc tip as a Q).
  closed: "M7.4 9.5 L11.3 5.6 Q12 4.9 12.7 5.6 L16.6 9.5",
  open: "M6.8 6.8 L11.3 11.3 Q12 12 12.7 11.3 L17.2 6.8",
};
const BOTTOM = {
  closed: "M7.4 14.5 L11.3 18.4 Q12 19.1 12.7 18.4 L16.6 14.5",
  open: "M6.8 17.2 L11.3 12.7 Q12 12 12.7 12.7 L17.2 17.2",
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
