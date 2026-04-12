"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setUsername } from "@/app/actions/onboarding";

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

    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="mb-8 text-lg font-semibold tracking-tight">
        Materialize
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Pick a username</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            This is how others will find you
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) =>
                  setUsernameValue(
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
                Letters, numbers, underscores, hyphens
              </p>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              type="submit"
              className="w-full"
              disabled={loading || username.length < 3}
            >
              {loading ? "Setting up..." : "Continue to dashboard"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
