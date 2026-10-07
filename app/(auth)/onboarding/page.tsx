"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { AuthHeading, AuthPage } from "@/components/auth/auth-shell";
import { setUsername } from "@/app/actions/onboarding";
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from "@/lib/handles/limits";

export default function OnboardingPage() {
  const router = useRouter();
  const [username, setUsernameValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await setUsername(username);
    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push("/");
  };

  return (
    <AuthPage>
      <AuthHeading
        title="Pick a username"
        description="This is how people find you and your files."
      />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              value={username}
              onChange={(e) =>
                setUsernameValue(
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
              className="pl-7"
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
          Continue
        </Button>
      </form>
    </AuthPage>
  );
}
