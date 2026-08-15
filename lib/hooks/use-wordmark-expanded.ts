"use client";

import { useState } from "react";
import { useScrolled } from "./use-scrolled";

/**
 * The `expanded` prop for a nav lockup that plays its wipe-in on load
 * and then peels to the mark on scroll.
 *
 * Returns `undefined` until the first scroll. That is not a "not ready"
 * placeholder — it is load-bearing: `AnimatedWordmark` treats an unset
 * `expanded` as mount mode and runs the CSS-keyframe reveal, and only
 * switches to the two-way transition once a boolean arrives. Handing it
 * a boolean from the start would skip the wipe-in entirely.
 *
 * Shared by the desktop `TopBar` and the mobile brand pill so the two
 * lockups can never drift out of step — they are the same logo on the
 * same page, just at different breakpoints.
 */
export function useWordmarkExpanded(): boolean | undefined {
  const scrolled = useScrolled();
  // "Has ever scrolled" is genuinely stateful — nothing derives it once
  // the user scrolls back to the top, which is the point: the wipe-in
  // plays once, then scroll owns the lockup.
  //
  // Latched during render, not in an effect. React supports a
  // conditional setState in the render phase — it re-renders
  // immediately without committing the first pass — and it is the only
  // form the compiler lint accepts here; `set-state-in-effect` rejects
  // the effect version, and a ref mutated during render would be
  // unsound under StrictMode double-invocation.
  const [armed, setArmed] = useState(false);
  if (scrolled && !armed) setArmed(true);
  return armed ? !scrolled : undefined;
}
