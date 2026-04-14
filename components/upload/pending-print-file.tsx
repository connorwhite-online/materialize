"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

type Format = "stl" | "obj" | "3mf" | "step" | "amf";

interface PendingPrintFile {
  file: File;
  format: Format;
}

interface PendingPrintFileContextValue {
  /** Stash a picked file to be consumed by the next /print mount. */
  set: (picked: PendingPrintFile) => void;
  /**
   * Read-and-clear the pending file. Returns null if nothing is
   * stashed. Used by InlineUploadDropzone on mount to auto-fire the
   * draft flow when an anon user arrived via "Print this file" on
   * the home bottom bar.
   */
  consume: () => PendingPrintFile | null;
  /** Cheap check without clearing — useful for hydration guards. */
  peek: () => PendingPrintFile | null;
}

const PendingPrintFileContext =
  createContext<PendingPrintFileContextValue | null>(null);

export function PendingPrintFileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // The file itself is held in a ref so navigations don't trigger a
  // rerender from the write side. A tiny version counter lets any
  // component that really needs to observe changes opt in via the
  // consume/peek helpers.
  const ref = useRef<PendingPrintFile | null>(null);
  const [, setVersion] = useState(0);

  const set = useCallback((picked: PendingPrintFile) => {
    ref.current = picked;
    setVersion((v) => v + 1);
  }, []);

  const consume = useCallback(() => {
    const current = ref.current;
    if (current) {
      ref.current = null;
      setVersion((v) => v + 1);
    }
    return current;
  }, []);

  const peek = useCallback(() => ref.current, []);

  return (
    <PendingPrintFileContext.Provider value={{ set, consume, peek }}>
      {children}
    </PendingPrintFileContext.Provider>
  );
}

export function usePendingPrintFile(): PendingPrintFileContextValue {
  const ctx = useContext(PendingPrintFileContext);
  if (!ctx) {
    throw new Error(
      "usePendingPrintFile must be used inside PendingPrintFileProvider"
    );
  }
  return ctx;
}
