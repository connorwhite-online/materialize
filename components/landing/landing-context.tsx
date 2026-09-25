"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { RESTING_WORD, wrapIndex } from "./landing-materials";

export interface Burst {
  key: number;
  /** Direction particles fly, -1 left / +1 right. */
  direction: number;
  intensity: number;
  /** Material being swiped away — the particles are made of it. */
  from: number;
}

interface LandingState {
  material: number;
  word: string;
  burst: Burst;
  /** Swipe tension in [-1, 1]; read every frame by the scene. */
  tensionRef: MutableRefObject<number>;
  /** Scroll progress in sections (0 → 3); written on scroll, read per frame. */
  progressRef: MutableRefObject<number>;
  ready: boolean;
  setReady: (ready: boolean) => void;
  setWord: (word: string) => void;
  /** Jump to a material and fire the particle shed for it. */
  select: (index: number, direction: number, intensity?: number) => void;
}

const LandingContext = createContext<LandingState | null>(null);

export function LandingProvider({ children }: { children: ReactNode }) {
  const [material, setMaterial] = useState(0);
  const [word, setWord] = useState(RESTING_WORD);
  const [burst, setBurst] = useState<Burst>({
    key: 0,
    direction: 0,
    intensity: 1,
    from: 0,
  });
  const [ready, setReady] = useState(false);
  const tensionRef = useRef(0);
  const materialRef = useRef(0);
  const progressRef = useRef(0);

  const select = useCallback(
    (index: number, direction: number, intensity = 1) => {
      // `direction` is the carousel step (+1 next), which is opposite the
      // finger, so the spray flies with the gesture when negated.
      // Read before overwriting: the updater below runs lazily.
      const from = materialRef.current;
      setBurst((b) => ({
        key: b.key + 1,
        direction: -direction,
        intensity,
        from,
      }));
      materialRef.current = wrapIndex(index);
      setMaterial(materialRef.current);
    },
    [],
  );

  const value = useMemo(
    () => ({
      material,
      word,
      burst,
      tensionRef,
      progressRef,
      ready,
      setReady,
      setWord,
      select,
    }),
    [material, word, burst, ready, select],
  );

  return (
    <LandingContext.Provider value={value}>{children}</LandingContext.Provider>
  );
}

export function useLanding(): LandingState {
  const ctx = useContext(LandingContext);
  if (!ctx) throw new Error("useLanding must be used inside <LandingProvider>");
  return ctx;
}
