import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInForm } from "@/components/auth/sign-in-form";

/**
 * Unlinked password sign-in for app-directory reviewers. OpenAI rejects
 * listings whose test login needs an emailed code, and our normal sign-in
 * is email-code or social only. The reviewer signs in here first; the
 * Clerk session then carries them straight through ChatGPT's OAuth
 * connect without hitting the normal sign-in form.
 *
 * Only the reviewer account has a password (Clerk: "Add password to
 * account" on, "Sign-up with password" off), so this page does nothing
 * for anyone else. It is reachable at the proxy layer through the
 * single-segment public matcher.
 */
export const metadata: Metadata = {
  title: "Reviewer sign-in",
  robots: { index: false, follow: false },
};

export default function ReviewSignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Reviewer sign-in</CardTitle>
        </CardHeader>
        <CardContent>
          <SignInForm passwordOnly redirectUrl="/" />
        </CardContent>
      </Card>
    </div>
  );
}
