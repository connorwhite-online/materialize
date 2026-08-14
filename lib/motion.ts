import type { Transition } from "motion/react";

/**
 * Shared motion presets. The numbers were filmed against Linear's nav
 * (`components/nav/mobile-nav.tsx`) and the brand wordmark ease
 * (`--mz-ease` in globals.css). Import these instead of restating a
 * spring so a retune lands everywhere the same feel is supposed to.
 */

/**
 * Fast, with a hair of overshoot and no wobble. Container-sized
 * motion — width, height, icon flicks.
 */
export const SPRING: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.8,
};

/**
 * Critically damped — collapsing height must not overshoot past 0.
 */
export const SPRING_CLOSE: Transition = {
  type: "spring",
  stiffness: 460,
  damping: 44,
};

/**
 * Softer settle for content that lands after its container: a short
 * lift that comes into focus. Pair with a tween on `filter` — springs
 * on blur read drunk.
 */
export const SPRING_SETTLE: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.7,
};

/** Matches `--mz-ease` / `--ease-out-soft`. Focus-in, not bounce. */
export const EASE_OUT_SOFT = [0.22, 0.9, 0.28, 1] as const;
