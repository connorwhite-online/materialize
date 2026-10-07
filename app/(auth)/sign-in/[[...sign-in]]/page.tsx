"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { AuthLegal, AuthPage } from "@/components/auth/auth-shell";

export default function SignInPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect_url") ?? "/";

  // Users can land here already signed in — e.g. bouncing back from
  // Stripe Checkout after finishing the inline OTP signup earlier in
  // the flow. Forward them instead of showing a dead form that just
  // says "you're already signed in".
  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace(redirectUrl);
    }
  }, [authLoaded, isSignedIn, router, redirectUrl]);

  // No card: the column is the form (DESIGN_SYSTEM.md § Space). Same
  // anatomy as the Vercel / ElevenLabs logins — mark, one heading,
  // social, email, one primary action, quiet links.
  return (
    <AuthPage>
      <SignInForm redirectUrl={redirectUrl} socialFirst />
      <AuthLegal className="mt-8" />
    </AuthPage>
  );
}
