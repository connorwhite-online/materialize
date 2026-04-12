"use client";

import { createContext, useContext, useState, useCallback } from "react";
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

  const openAuth = useCallback((newMode: Mode = "sign-in") => {
    setMode(newMode);
    setOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <AuthModalContext.Provider value={{ openAuth, closeAuth }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
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
