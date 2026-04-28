"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

type Mode = "sign-in" | "sign-up";

interface AuthModalContextValue {
  openAuth: (mode?: Mode) => void;
  closeAuth: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

/**
 * Custom event fired on `window` whenever the modal blocks an
 * outside-press / escape-key. Forms listen for it to re-focus their
 * active input — most importantly the hidden OTP input which can
 * lose focus when the user clicks the dim overlay.
 */
export const AUTH_MODAL_SHAKE_EVENT = "auth-modal:shake";

const SHAKE_CLASS = "auth-modal-shake";
const SHAKE_DURATION_MS = 280;

export function useAuthModal() {
  const ctx = useContext(AuthModalContext);
  if (!ctx) {
    throw new Error("useAuthModal must be used within AuthModalProvider");
  }
  return ctx;
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("sign-in");
  const popupRef = useRef<HTMLDivElement>(null);
  const shakeTimer = useRef<number | null>(null);

  const openAuth = useCallback((newMode: Mode = "sign-in") => {
    setMode(newMode);
    setOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setOpen(false);
  }, []);

  const triggerShake = useCallback(() => {
    const el = popupRef.current;
    if (!el) return;
    // Re-trigger pattern: remove the class, force a reflow, then
    // re-add — ensures the keyframe restarts cleanly even if the
    // user clicks outside multiple times in rapid succession.
    el.classList.remove(SHAKE_CLASS);
    void el.offsetWidth;
    el.classList.add(SHAKE_CLASS);
    if (shakeTimer.current !== null) {
      window.clearTimeout(shakeTimer.current);
    }
    shakeTimer.current = window.setTimeout(() => {
      el.classList.remove(SHAKE_CLASS);
      shakeTimer.current = null;
    }, SHAKE_DURATION_MS);
    // Forms in the code/OTP step latch onto this to recover focus.
    window.dispatchEvent(new CustomEvent(AUTH_MODAL_SHAKE_EVENT));
  }, []);

  return (
    <AuthModalContext.Provider value={{ openAuth, closeAuth }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(nextOpen, details) => {
          // Only allow closing via the X button or programmatic close.
          // Block outside-press and escape-key so users can't accidentally
          // abandon a half-filled sign-in — and shake the modal to make
          // it obvious the click was intentional but ignored.
          const reason = details?.reason;
          if (
            !nextOpen &&
            (reason === "outside-press" || reason === "escape-key")
          ) {
            triggerShake();
            return;
          }
          setOpen(nextOpen);
        }}
      >
        <DialogContent
          className="sm:max-w-sm"
          // ref reaches the popup root so triggerShake() can toggle the
          // shake class on the same element that owns the centering
          // transform — keyframes drive the whole transform property
          // and include the -50%, -50% centering, so we don't fight a
          // composition battle with Tailwind's translate utilities.
          ref={popupRef}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              {mode === "sign-in" ? "Sign in" : "Create an account"}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            {mode === "sign-in" ? (
              <SignInForm onSuccess={closeAuth} />
            ) : (
              <SignUpForm onSuccess={closeAuth} />
            )}
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "sign-in" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("sign-up")}
                  className="text-foreground transition-colors hover:text-foreground/80"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("sign-in")}
                  className="text-foreground transition-colors hover:text-foreground/80"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </DialogContent>
      </Dialog>
    </AuthModalContext.Provider>
  );
}
