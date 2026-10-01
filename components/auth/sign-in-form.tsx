"use client";

import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { setUsername } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
} from "@/lib/handles/limits";
import { SocialButtons } from "./social-buttons";

type Step = "identifier" | "code" | "username";

interface SignInFormProps {
  onSuccess?: () => void;
  redirectUrl?: string;
  /** Social buttons above the email form (sign-in page layout). */
  socialFirst?: boolean;
}

function errorMessage(
  error: { longMessage?: string; message?: string } | null,
  fallback: string
): string {
  return error?.longMessage ?? error?.message ?? fallback;
}

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

export function SignInForm({
  onSuccess,
  redirectUrl = "/",
  socialFirst = false,
}: SignInFormProps) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const router = useRouter();

  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsernameInput] = useState("");
  const [step, setStep] = useState<Step>("identifier");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Password sign-in exists for accounts that can't receive an email
  // code, chiefly the app-directory reviewer account (OpenAI rejects
  // listings whose test login needs an emailed code). Nobody else has
  // a password, so it stays a quiet text link rather than a field.
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");

  const finishSignedIn = async () => {
    const { error: finalizeError } = await signIn.finalize({
      navigate: () => {
        if (onSuccess) {
          onSuccess();
          router.refresh();
        } else {
          router.push(redirectUrl);
          router.refresh();
        }
      },
    });
    if (finalizeError) {
      setError(errorMessage(finalizeError, "Something went wrong"));
    }
  };

  const resetToIdentifier = async () => {
    await signIn.reset();
    setStep("identifier");
    setCode("");
    setError("");
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const useSignUpIfMissing = looksLikeEmail(identifier);

    const { error: createError } = await signIn.create({
      identifier,
      ...(useSignUpIfMissing ? { signUpIfMissing: true } : {}),
    });

    if (createError) {
      if (
        !useSignUpIfMissing &&
        createError.code === "form_identifier_not_found"
      ) {
        setError("No account found with that username.");
      } else {
        setError(errorMessage(createError, "Something went wrong"));
      }
      setLoading(false);
      return;
    }

    const { error: sendError } = await signIn.emailCode.sendCode();
    if (sendError) {
      setError(errorMessage(sendError, "Couldn't send verification code"));
      setLoading(false);
      return;
    }

    setStep("code");
    setLoading(false);
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: passwordError } = await signIn.password({
      identifier,
      password,
    });
    if (passwordError) {
      setError(errorMessage(passwordError, "Incorrect email or password"));
      setLoading(false);
      return;
    }

    if (signIn.status === "complete") {
      await finishSignedIn();
    } else {
      setError("This account needs another sign-in step. Use an email code.");
    }
    setLoading(false);
  };

  const handleTransferToSignUp = async () => {
    const { error: transferError } = await signUp.create({ transfer: true });
    if (transferError) {
      setError(errorMessage(transferError, "Something went wrong"));
      return false;
    }

    if (signUp.status === "complete") {
      const { error: finalizeError } = await signUp.finalize({
        navigate: () => {
          setStep("username");
        },
      });
      if (finalizeError) {
        setError(errorMessage(finalizeError, "Something went wrong"));
        return false;
      }
      return true;
    }

    if (signUp.status === "missing_requirements") {
      setError("Additional sign-up details are required.");
      return false;
    }

    setError("Sign-up could not be completed.");
    return false;
  };

  const handleVerifyCode = async (value: string) => {
    if (value.length < 6) return;
    setLoading(true);
    setError("");

    const { error: verifyError } = await signIn.emailCode.verifyCode({
      code: value,
    });

    if (verifyError?.code === "sign_up_if_missing_transfer") {
      await handleTransferToSignUp();
      setLoading(false);
      return;
    }

    if (verifyError) {
      setError(errorMessage(verifyError, "Invalid code"));
      setCode("");
      setLoading(false);
      return;
    }

    if (signIn.status === "complete") {
      await finishSignedIn();
    }

    setLoading(false);
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
            minLength={MIN_USERNAME_LENGTH}
            maxLength={MAX_USERNAME_LENGTH}
            autoFocus
          />
          <p className="mt-2 text-xs text-muted-foreground">
            This is how others will find you
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="submit"
          size="xl"
          className="w-full"
          disabled={loading || username.length < MIN_USERNAME_LENGTH}
        >
          {loading ? "Finishing up..." : "Complete sign-up"}
        </Button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <div className="space-y-4 pb-4">
        <p className="text-sm text-muted-foreground text-center">
          Enter the code we sent to {identifier}
        </p>
        {/* Explicit row height: the slots must always reserve their own
            space, even if input-otp's container is measured as zero-height
            (iOS Safari), otherwise they overlap the copy and link. */}
        <div className="flex h-12 shrink-0 justify-center">
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
            void resetToIdentifier();
          }}
          className="block w-full cursor-pointer text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Use a different account
        </button>
      </div>
    );
  }

  const identifierForm = (
    <form
      onSubmit={usePassword ? handlePasswordSignIn : handleSendCode}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="identifier">Email or username</Label>
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

      {usePassword && (
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button
        type="submit"
        size="xl"
        className="w-full"
        disabled={loading || !identifier || (usePassword && !password)}
      >
        {usePassword
          ? loading
            ? "Signing in..."
            : "Sign in"
          : loading
            ? "Sending code..."
            : "Continue"}
      </Button>

      <button
        type="button"
        onClick={() => {
          setUsePassword((v) => !v);
          setPassword("");
          setError("");
        }}
        className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
      >
        {usePassword ? "Email me a code instead" : "Sign in with a password"}
      </button>
    </form>
  );

  const social = <SocialButtons mode="sign-in" />;

  return (
    <div className="space-y-4">
      {socialFirst ? (
        <>
          {social}
          {identifierForm}
        </>
      ) : (
        <>
          {identifierForm}
          {social}
        </>
      )}
      <div id="clerk-captcha" />
    </div>
  );
}
