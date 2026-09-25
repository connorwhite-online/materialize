"use client";

import {
  createContext,
  useCallback,
  useEffect,
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
  /**
   * How far the FAQ sheet has been pulled up over the stage, 0 → 1;
   * written on scroll, read per frame. Drives the reassemble-and-zoom.
   */
  zoomRef: MutableRefObject<number>;
  /** Current step of the first-screen stepper (see STEPS). */
  step: number;
  /** Autoplay is running (not paused by interaction or the user). */
  playing: boolean;
  /** Go to a step. Counts as interaction: pauses autoplay. */
  goTo: (step: number) => void;
  /** Autoplay tick — the active dot's fill finished. */
  advance: () => void;
  /** Pause/play button. An explicit pause stays paused. */
  togglePlay: () => void;
  /** Any other manipulation (a swipe): pause, resume after idle. */
  interact: () => void;
  ready: boolean;
  setReady: (ready: boolean) => void;
  setWord: (word: string) => void;
  /** Jump to a material and fire the particle shed for it. */
  select: (index: number, direction: number, intensity?: number) => void;
}

/** The first-screen stepper: one choreography keyframe per step. */
export const STEPS = [
  { id: "print", label: "Print in any material" },
  { id: "share", label: "Share your files" },
  { id: "build", label: "Host the whole build" },
] as const;
export const STEP_MS = 6000;
export const RESUME_AFTER_MS = 10_000;

export function wrapStep(i: number): number {
  const n = STEPS.length;
  return ((i % n) + n) % n;
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
  const zoomRef = useRef(0);
  const [step, setStep] = useState(0);
  // auto: advancing. idle: paused by a swipe/tap, resumes after
  // RESUME_AFTER_MS without input. held: paused with the button — stays.
  const [mode, setMode] = useState<"auto" | "idle" | "held">("auto");
  const resumeTimer = useRef<number | undefined>(undefined);

  const interact = useCallback(() => {
    setMode((m) => (m === "held" ? m : "idle"));
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      setMode((m) => (m === "idle" ? "auto" : m));
    }, RESUME_AFTER_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  const goTo = useCallback(
    (next: number) => {
      setStep(wrapStep(next));
      interact();
    },
    [interact],
  );
  const advance = useCallback(() => setStep((s) => wrapStep(s + 1)), []);
  const togglePlay = useCallback(() => {
    window.clearTimeout(resumeTimer.current);
    setMode((m) => (m === "auto" ? "held" : "auto"));
  }, []);

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
      zoomRef,
      step,
      playing: mode === "auto",
      goTo,
      advance,
      togglePlay,
      interact,
      ready,
      setReady,
      setWord,
      select,
    }),
    [
      material,
      word,
      burst,
      ready,
      select,
      step,
      mode,
      goTo,
      advance,
      togglePlay,
      interact,
    ],
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
