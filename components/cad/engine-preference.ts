import { useCallback, useSyncExternalStore } from "react";

import { isCadEngineId, type CadEngineId } from "@/lib/cad/engines/types";

/**
 * The composer's engine toggle, remembered per viewer (docs/text-to-cad/11).
 *
 * Without this the toggle snapped back to B-rep on every reload, so running a
 * series of SDF builds meant re-picking SDF each time, and forgetting once
 * silently ran the wrong engine.
 *
 * localStorage, not a DB column: it is a per-browser convenience, and losing
 * it (private window, cleared site data) just means starting on the default.
 * Every access is guarded because the accessor itself can throw.
 */
export const ENGINE_PREFERENCE_KEY = "materialize:cad-engine";

/** Same-tab change signal; the `storage` event only fires in OTHER tabs. */
const CHANGE_EVENT = "materialize:cad-engine-change";

export function readEnginePreference(): CadEngineId {
  try {
    const raw = window.localStorage.getItem(ENGINE_PREFERENCE_KEY);
    return isCadEngineId(raw) ? raw : "brep";
  } catch {
    return "brep";
  }
}

export function writeEnginePreference(engine: CadEngineId): void {
  try {
    window.localStorage.setItem(ENGINE_PREFERENCE_KEY, engine);
  } catch {
    // Private mode / quota: the choice still applies to this build, it just
    // won't survive a reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === ENGINE_PREFERENCE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The remembered engine and a setter. useSyncExternalStore rather than
 * useState + an effect: the server snapshot is "brep", the client reads
 * storage after hydration without a mismatch warning, and it needs no
 * setState-in-effect (which the React compiler lint rejects).
 */
export function useEnginePreference(): [
  CadEngineId,
  (engine: CadEngineId) => void,
] {
  const engine = useSyncExternalStore(
    subscribe,
    readEnginePreference,
    () => "brep" as const
  );
  const set = useCallback(
    (next: CadEngineId) => writeEnginePreference(next),
    []
  );
  return [engine, set];
}
