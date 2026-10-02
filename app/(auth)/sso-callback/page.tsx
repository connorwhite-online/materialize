"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";
import { DottedSpinner } from "@/components/icons/dotted-spinner";

export default function SSOCallbackPage() {
  const { handleRedirectCallback } = useClerk();

  useEffect(() => {
    handleRedirectCallback({
      signUpFallbackRedirectUrl: "/onboarding",
      signInFallbackRedirectUrl: "/",
    });
  }, [handleRedirectCallback]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="mz-enter flex flex-col items-center text-center">
        <DottedSpinner size={28} className="text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Signing you in…</p>
      </div>
    </div>
  );
}
