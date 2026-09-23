"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False on the server AND during hydration, true on every render after.
 *
 * For state that has to come from the browser (sessionStorage,
 * localStorage) without breaking hydration. Reading storage inside a
 * `useState` initializer gives the server one value and the hydrating client
 * another, and React throws away the whole server tree: the studio did this
 * with its resume slot, so every quick return to /prometheus logged
 * "Hydration failed". Gate the read on this instead and latch it in render
 * (see useWordmarkExpanded for why render and not an effect).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
