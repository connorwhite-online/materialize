"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";

export default function SSOCallbackPage() {
  const { handleRedirectCallback } = useClerk();

  useEffect(() => {
    handleRedirectCallback({
      signUpFallbackRedirectUrl: "/onboarding",
      signInFallbackRedirectUrl: "/dashboard",
    });
  }, [handleRedirectCallback]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}
