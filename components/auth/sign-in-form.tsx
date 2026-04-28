"use client";

import { useState } from "react";
import { useSignIn } from "@clerk/nextjs/legacy";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Separator } from "@/components/ui/separator";
import { SocialButtons } from "./social-buttons";

type CodeStrategy = "email_code" | "phone_code";

interface SignInFormProps {
  onSuccess?: () => void;
  redirectUrl?: string;
}

export function SignInForm({ onSuccess, redirectUrl = "/dashboard" }: SignInFormProps) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"identifier" | "code">("identifier");
  const [strategy, setStrategy] = useState<CodeStrategy>("email_code");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setLoading(true);
    setError("");

    try {
      const { supportedFirstFactors } = await signIn.create({ identifier });

      const emailFactor = supportedFirstFactors?.find(
        (f) => f.strategy === "email_code"
      );
      const phoneFactor = supportedFirstFactors?.find(
        (f) => f.strategy === "phone_code"
      );

      if (emailFactor && "emailAddressId" in emailFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailFactor.emailAddressId,
        });
        setStrategy("email_code");
        setStep("code");
      } else if (phoneFactor && "phoneNumberId" in phoneFactor) {
        await signIn.prepareFirstFactor({
          strategy: "phone_code",
          phoneNumberId: phoneFactor.phoneNumberId,
        });
        setStrategy("phone_code");
        setStep("code");
      } else {
        setError("No verification method available for this account.");
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
        strategy,
        code: value,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        if (onSuccess) {
          onSuccess();
          router.refresh();
        } else {
          router.push(redirectUrl);
          router.refresh();
        }
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

  if (step === "code") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          We sent a code to {identifier}
        </p>
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
          Use a different account
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSendCode} className="space-y-5">
        <div>
          <Label htmlFor="identifier">Email, phone, or username</Label>
          <Input
            id="identifier"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="submit"
          size="xl"
          className="w-full"
          disabled={loading || !identifier}
        >
          {loading ? "Sending code..." : "Continue"}
        </Button>
      </form>

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
          or
        </span>
      </div>

      <SocialButtons mode="sign-in" />
    </div>
  );
}
