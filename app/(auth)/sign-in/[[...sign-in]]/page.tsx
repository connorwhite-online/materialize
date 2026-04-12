"use client";

import { useState, useEffect, useRef } from "react";
import { useSignIn } from "@clerk/nextjs/legacy";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "email") {
      emailInputRef.current?.focus();
    }
  }, [step]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setLoading(true);
    setError("");

    try {
      const { supportedFirstFactors } = await signIn.create({
        identifier: email,
      });

      const emailFactor = supportedFirstFactors?.find(
        (f) => f.strategy === "email_code"
      );

      if (emailFactor && "emailAddressId" in emailFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
        setStep("code");
      } else {
        setError("Email sign-in is not available for this account.");
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ longMessage?: string }> };
      setError(
        clerkErr.errors?.[0]?.longMessage ||
          (err instanceof Error ? err.message : "Something went wrong")
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (value: string) => {
    if (!isLoaded || !signIn || value.length < 6) return;
    setLoading(true);
    setError("");

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: value,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ longMessage?: string }> };
      setError(
        clerkErr.errors?.[0]?.longMessage ||
          (err instanceof Error ? err.message : "Invalid code")
      );
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight">
        Materialize
      </Link>

      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {step === "email" ? "Sign in" : "Check your email"}
          </CardTitle>
          {step === "code" && (
            <p className="text-sm text-muted-foreground mt-1">
              We sent a code to {email}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={handleSendCode} className="space-y-5">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  ref={emailInputRef}
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !email}
              >
                {loading ? "Sending code..." : "Continue with email"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    if (value.length === 6) handleVerifyCode(value);
                  }}
                  autoFocus
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}
              {loading && (
                <p className="text-xs text-muted-foreground text-center">
                  Verifying...
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                }}
                className="block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/sign-up"
          className="text-foreground transition-colors hover:text-foreground/80"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
