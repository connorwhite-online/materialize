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

interface LandingState {
  /** Drag-orbit pull on the share/BOM steps, [-1, 1]; springs back to 0. */
  orbitRef: MutableRefObject<number>;
  /** Current step of the first-screen stepper (see STEPS). */
  step: number;
  /** Autoplay is running (not paused by interaction). */
  playing: boolean;
  /** Go to a step. Counts as interaction: pauses autoplay. */
  goTo: (step: number) => void;
  /** Autoplay tick — the active dot's fill finished. */
  advance: () => void;
  /** Any other manipulation (a swipe): pause, resume after idle. */
  interact: () => void;
}

/** The first-screen stepper: one choreography keyframe per step. */
export const STEPS = [
  { id: "print", label: "Print in any material" },
  { id: "build", label: "Host the whole build" },
  { id: "agents", label: "Built with agents" },
] as const;
export const STEP_MS = 6000;
export const RESUME_AFTER_MS = 10_000;

export function wrapStep(i: number): number {
  const n = STEPS.length;
  return ((i % n) + n) % n;
}

const LandingContext = createContext<LandingState | null>(null);

export function LandingProvider({ children }: { children: ReactNode }) {
  const orbitRef = useRef(0);
  const [step, setStep] = useState(0);
  // auto: advancing. idle: any interaction stops it; it resumes after
  // RESUME_AFTER_MS without input. There's no manual pause — interacting
  // is the pause.
  const [mode, setMode] = useState<"auto" | "idle">("auto");
  const resumeTimer = useRef<number | undefined>(undefined);

  const interact = useCallback(() => {
    setMode("idle");
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      setMode("auto");
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

  const value = useMemo(
    () => ({
      orbitRef,
      step,
      playing: mode === "auto",
      goTo,
      advance,
      interact,
    }),
    [step, mode, goTo, advance, interact],
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
