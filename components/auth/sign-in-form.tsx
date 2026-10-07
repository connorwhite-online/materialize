"use client";

import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { setUsername } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { OtpField } from "@/components/ui/otp-field";
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from "@/lib/handles/limits";
import { SocialButtons } from "./social-buttons";
import { AuthDivider, AuthHeading, AuthTextButton } from "./auth-shell";

type Step = "identifier" | "code" | "username";

interface SignInFormProps {
  onSuccess?: () => void;
  redirectUrl?: string;
  /** Social buttons above the email form (sign-in page layout). */
  socialFirst?: boolean;
  /** Render the per-step heading ("Log in or sign up", "Check your email"). */
  showHeading?: boolean;
  /** `h2` inside a dialog, whose title is its own landmark. */
  headingAs?: "h1" | "h2";
}

function errorMessage(
  error: { longMessage?: string; message?: string } | null,
  fallback: string,
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
  showHeading = true,
  headingAs = "h1",
}: SignInFormProps) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const router = useRouter();

  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  // Password sign-in is a secondary path: email codes are the default
  // and nobody signs up with a password. It exists for accounts that
  // were given one in the Clerk dashboard, chiefly the plugin-directory
  // reviewer, whose login can't depend on reading an inbox.
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [username, setUsernameInput] = useState("");
  const [step, setStep] = useState<Step>("identifier");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

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

  const handleResend = async () => {
    setError("");
    setResent(false);
    const { error: sendError } = await signIn.emailCode.sendCode();
    if (sendError) {
      setError(errorMessage(sendError, "Couldn't send a new code"));
      return;
    }
    setCode("");
    setResent(true);
  };

  const resetToIdentifier = async () => {
    setResent(false);
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
      setError(
        "This account needs another sign-in step. Use an email code instead.",
      );
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

  const heading = (title: React.ReactNode, description?: React.ReactNode) =>
    showHeading ? (
      <AuthHeading title={title} description={description} as={headingAs} />
    ) : null;

  const errorLine = error ? (
    <p role="alert" className="text-[13px] leading-[18px] text-destructive">
      {error}
    </p>
  ) : null;

  if (step === "username") {
    return (
      <div>
        {heading(
          "Pick a username",
          "This is how people find you and your files.",
        )}
        <form onSubmit={handleSetUsername} className="flex flex-col gap-4">
          <Field
            label="Username"
            htmlFor="username"
            hint={`Letters, numbers, underscores and hyphens. At least ${MIN_USERNAME_LENGTH} characters.`}
            error={error || undefined}
          >
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-subtle-foreground md:text-sm"
              >
                @
              </span>
              <Input
                id="username"
                className="pl-7"
                value={username}
                onChange={(e) =>
                  setUsernameInput(
                    e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                  )
                }
                placeholder="yourname"
                required
                minLength={MIN_USERNAME_LENGTH}
                maxLength={MAX_USERNAME_LENGTH}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                aria-invalid={error ? true : undefined}
              />
            </div>
          </Field>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={loading}
            disabled={username.length < MIN_USERNAME_LENGTH}
          >
            Complete sign-up
          </Button>
        </form>
      </div>
    );
  }

  if (step === "code") {
    const destination = looksLikeEmail(identifier) ? (
      <span className="font-medium text-foreground">{identifier}</span>
    ) : (
      "the email on that account"
    );
    return (
      <div className="flex flex-col gap-4">
        {heading(
          "Check your email",
          <>Enter the 6-digit code we sent to {destination}.</>,
        )}
        <OtpField
          value={code}
          onChange={(value) => {
            setCode(value);
            if (value.length === 6) handleVerifyCode(value);
          }}
          disabled={loading}
          aria-invalid={error ? true : undefined}
          autoFocus
        />

        <div className="min-h-[18px] text-center" aria-live="polite">
          {error ? (
            <p
              role="alert"
              className="text-[13px] leading-[18px] text-destructive"
            >
              {error}
            </p>
          ) : loading ? (
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              Verifying…
            </p>
          ) : resent ? (
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              New code sent.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-center gap-1">
          <AuthTextButton
            onClick={() => void handleResend()}
            disabled={loading}
          >
            Resend code
          </AuthTextButton>
          <span aria-hidden className="text-subtle-foreground">
            ·
          </span>
          <AuthTextButton
            onClick={() => {
              void resetToIdentifier();
            }}
          >
            Use a different account
          </AuthTextButton>
        </div>
      </div>
    );
  }

  const identifierForm = (
    <form
      onSubmit={usePassword ? handlePasswordSignIn : handleSendCode}
      className="flex flex-col gap-4"
    >
      <Field label="Email or username" htmlFor="identifier">
        <Input
          id="identifier"
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@example.com"
          required
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>

      {usePassword && (
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
      )}

      {errorLine}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={loading}
        disabled={!identifier || (usePassword && !password)}
      >
        {usePassword ? "Sign in" : "Continue"}
      </Button>

      <AuthTextButton
        onClick={() => {
          setUsePassword((v) => !v);
          setPassword("");
          setError("");
        }}
      >
        {usePassword ? "Email me a code instead" : "Use a password"}
      </AuthTextButton>
    </form>
  );

  const social = <SocialButtons mode="sign-in" />;

  return (
    <div>
      {heading(
        "Log in or sign up",
        usePassword
          ? "Sign in with your password."
          : "No password needed. We'll email you a code.",
      )}
      <div className="flex flex-col gap-5">
        {socialFirst ? (
          <>
            {social}
            <AuthDivider />
            {identifierForm}
          </>
        ) : (
          <>
            {identifierForm}
            <AuthDivider />
            {social}
          </>
        )}
      </div>
      <div id="clerk-captcha" />
    </div>
  );
}
