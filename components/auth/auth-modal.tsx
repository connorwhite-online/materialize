"use client";

import { createContext, useContext, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnimatedWordmark } from "@/components/brand/logo";
import { SignInForm } from "./sign-in-form";

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

  const openAuth = useCallback((_mode?: Mode) => {
    setOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <AuthModalContext.Provider value={{ openAuth, closeAuth }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(nextOpen, details) => {
          // Only allow closing via the X button or programmatic close.
          // Block outside-press and escape-key so users can't accidentally
          // abandon a half-filled sign-in.
          const reason = details?.reason;
          if (
            !nextOpen &&
            (reason === "outside-press" || reason === "escape-key")
          ) {
            return;
          }
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="gap-3 rounded-3xl pb-0 sm:max-w-sm">
          <DialogHeader className="items-start pb-2">
            <AnimatedWordmark
              title="Materialize"
              animateOnMount
              height={13}
              className="text-foreground"
            />
            <DialogTitle className="sr-only">Sign in</DialogTitle>
          </DialogHeader>

          <SignInForm onSuccess={closeAuth} />
        </DialogContent>
      </Dialog>
    </AuthModalContext.Provider>
  );
}
