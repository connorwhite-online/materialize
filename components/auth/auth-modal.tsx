"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { motion, useAnimationControls } from "motion/react";
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
  const shakeControls = useAnimationControls();

  const openAuth = useCallback((newMode: Mode = "sign-in") => {
    setMode(newMode);
    setOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setOpen(false);
  }, []);

  const triggerShake = useCallback(() => {
    // Asymmetric, decaying offsets give the "springy" read — initial
    // swing further than the rebound, then a quick settle. Tighter
    // duration than a typical error shake so it reads as "missed a
    // step" rather than "you broke something."
    shakeControls.start({
      x: [0, -8, 6, -4, 2, 0],
      transition: { duration: 0.22, ease: [0.36, 0.07, 0.19, 0.97] },
    });
    // Forms in the code/OTP step latch onto this to recover focus.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_MODAL_SHAKE_EVENT));
    }
  }, [shakeControls]);

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
          // Swap the popup's underlying div for a motion element so the
          // shake moves the entire chrome (bg, border, shadow), not
          // just the inner content. transformTemplate composes the
          // centering translate with motion's animated x — without it,
          // motion would clobber the Tailwind -translate-1/2 used to
          // center the popup over the viewport.
          render={
            <motion.div
              animate={shakeControls}
              transformTemplate={({ x }) => {
                const xPx =
                  typeof x === "number" ? `${x}px` : (x ?? "0px");
                return `translate(calc(-50% + ${xPx}), -50%)`;
              }}
            />
          }
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
