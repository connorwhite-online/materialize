"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { AnimatedWordmark } from "@/components/brand/logo";

export default function SignInPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect_url") ?? "/dashboard";

  // Users can land here already signed in — e.g. bouncing back from
  // Stripe Checkout after finishing the inline OTP signup earlier in
  // the flow. Forward them instead of showing a dead form that just
  // says "you're already signed in".
  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace(redirectUrl);
    }
  }, [authLoaded, isSignedIn, router, redirectUrl]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Link
        href="/"
        aria-label="Materialize — home"
        className="mb-8 text-foreground transition-opacity hover:opacity-80"
      >
        <AnimatedWordmark
          animateOnMount
          className="[--mz-h:7px] sm:[--mz-h:8px]"
        />
      </Link>

      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <SignInForm redirectUrl={redirectUrl} socialFirst />
        </CardContent>
      </Card>
    </div>
  );
}
