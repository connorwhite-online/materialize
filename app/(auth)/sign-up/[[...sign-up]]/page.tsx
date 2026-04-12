"use client";

import { useState } from "react";
import { useSignUp } from "@clerk/nextjs/legacy";
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

export default function SignUpPage() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"details" | "code">("details");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    setLoading(true);
    setError("");

    try {
      await signUp.create({
        emailAddress: email,
        username,
      });

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });

      setStep("code");
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
    if (!isLoaded || !signUp || value.length < 6) return;
    setLoading(true);
    setError("");

    try {
      const result = await signUp.attemptEmailAddressVerification({
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
            {step === "details" ? "Create an account" : "Verify your email"}
          </CardTitle>
          {step === "code" && (
            <p className="text-sm text-muted-foreground mt-1">
              We sent a code to {email}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {step === "details" ? (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>

              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) =>
                    setUsername(
                      e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "")
                    )
                  }
                  placeholder="yourname"
                  required
                  minLength={3}
                  maxLength={30}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Letters, numbers, underscores, hyphens
                </p>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !email || !username}
              >
                {loading ? "Creating account..." : "Continue"}
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
                  setStep("details");
                  setCode("");
                  setError("");
                }}
                className="block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Go back
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-foreground transition-colors hover:text-foreground/80"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
