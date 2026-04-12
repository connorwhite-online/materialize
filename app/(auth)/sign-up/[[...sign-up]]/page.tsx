"use client";

import { useState } from "react";
import { useSignUp } from "@clerk/nextjs/legacy";
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
import { Separator } from "@/components/ui/separator";
import { SocialButtons } from "@/components/auth/social-buttons";

type Method = "email" | "phone";

export default function SignUpPage() {
  const { isLoaded, signUp, setActive } = useSignUp();

  const [method, setMethod] = useState<Method>("email");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"identifier" | "code">("identifier");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signUp) return;
    setLoading(true);
    setError("");

    try {
      if (method === "email") {
        await signUp.create({ emailAddress: value });
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      } else {
        await signUp.create({ phoneNumber: value });
        await signUp.preparePhoneNumberVerification({ strategy: "phone_code" });
      }
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

  const handleVerifyCode = async (codeValue: string) => {
    if (!isLoaded || !signUp || codeValue.length < 6) return;
    setLoading(true);
    setError("");

    try {
      const result =
        method === "email"
          ? await signUp.attemptEmailAddressVerification({ code: codeValue })
          : await signUp.attemptPhoneNumberVerification({ code: codeValue });

      // Debug: log everything Clerk returned
      console.log("[sign-up] verify result:", {
        status: result.status,
        missingFields: result.missingFields,
        unverifiedFields: result.unverifiedFields,
        requiredFields: result.requiredFields,
        createdSessionId: result.createdSessionId,
        createdUserId: result.createdUserId,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        window.location.href = "/onboarding";
        return;
      }

      // Show the user what Clerk is asking for
      const details = [
        `Status: ${result.status}`,
        result.missingFields?.length && `Missing: ${result.missingFields.join(", ")}`,
        result.unverifiedFields?.length && `Unverified: ${result.unverifiedFields.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" · ");
      setError(`Sign-up incomplete. ${details}`);
    } catch (err: unknown) {
      console.error("[sign-up] verify error:", err);
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
            {step === "identifier" ? "Create an account" : "Enter code"}
          </CardTitle>
          {step === "code" && (
            <p className="text-sm text-muted-foreground mt-1">
              We sent a code to {value}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {step === "identifier" ? (
            <div className="space-y-4">
              <SocialButtons mode="sign-up" />

              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  or
                </span>
              </div>

              <form onSubmit={handleSendCode} className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="value" className="mb-0">
                      {method === "email" ? "Email" : "Phone"}
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        setMethod(method === "email" ? "phone" : "email");
                        setValue("");
                        setError("");
                      }}
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Use {method === "email" ? "phone" : "email"} instead
                    </button>
                  </div>
                  <Input
                    id="value"
                    type={method === "email" ? "email" : "tel"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={
                      method === "email" ? "you@example.com" : "+1 555 123 4567"
                    }
                    required
                    autoFocus
                  />
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || !value}
                >
                  {loading ? "Sending code..." : "Continue"}
                </Button>
              </form>
            </div>
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
                  setStep("identifier");
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
