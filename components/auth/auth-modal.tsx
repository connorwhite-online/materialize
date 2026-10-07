"use client";

import { createContext, useContext, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Logomark } from "@/components/brand/logo";
import { SignInForm } from "./sign-in-form";
import { AuthLegal } from "./auth-shell";

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
        <DialogContent className="gap-0 rounded-3xl px-6 pt-8 pb-6 sm:max-w-[25rem]">
          <DialogHeader className="mb-6 items-center">
            <Logomark height={24} className="text-foreground" />
            <DialogTitle className="sr-only">Log in or sign up</DialogTitle>
          </DialogHeader>

          <SignInForm onSuccess={closeAuth} socialFirst headingAs="h2" />
          <AuthLegal className="mt-6" />
        </DialogContent>
      </Dialog>
    </AuthModalContext.Provider>
  );
}
