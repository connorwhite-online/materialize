"use client";

import { useState } from "react";
import { useSignUp } from "@clerk/nextjs/legacy";
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
import { setUsername } from "@/app/actions/onboarding";

type Method = "email" | "phone";
type Step = "identifier" | "code" | "username";

interface SignUpFormProps {
  onSuccess?: () => void;
  redirectUrl?: string;
}

export function SignUpForm({
  onSuccess,
  redirectUrl = "/",
}: SignUpFormProps) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [method, setMethod] = useState<Method>("email");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsernameInput] = useState("");
  const [step, setStep] = useState<Step>("identifier");
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

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        // Continue to username step
        setStep("username");
        return;
      }

      const details = [
        result.missingFields?.length && `Missing: ${result.missingFields.join(", ")}`,
        result.unverifiedFields?.length && `Unverified: ${result.unverifiedFields.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" · ");
      setError(details || `Sign-up incomplete (${result.status})`);
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

  const handleSetUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await setUsername(username);
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (onSuccess) {
      onSuccess();
      router.refresh();
    } else {
      router.push(redirectUrl);
      router.refresh();
    }
  };

  // Step 3: Username
  if (step === "username") {
    return (
      <form onSubmit={handleSetUsername} className="space-y-5">
        <div>
          <Label htmlFor="username">Pick a username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) =>
              setUsernameInput(
                e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "")
              )
            }
            placeholder="yourname"
            required
            minLength={3}
            maxLength={30}
            autoFocus
          />
          <p className="mt-2 text-xs text-muted-foreground">
            This is how others will find you
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="submit"
          className="w-full"
          disabled={loading || username.length < 3}
        >
          {loading ? "Finishing up..." : "Complete sign-up"}
        </Button>
      </form>
    );
  }

  // Step 2: OTP verification
  if (step === "code") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          We sent a code to {value}
        </p>
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={(codeValue) => {
              setCode(codeValue);
              if (codeValue.length === 6) handleVerifyCode(codeValue);
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
    );
  }

  // Step 1: Email/phone input
  return (
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

        <Button type="submit" className="w-full" disabled={loading || !value}>
          {loading ? "Sending code..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}
