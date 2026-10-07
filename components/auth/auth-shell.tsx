import Link from "next/link";
import type * as React from "react";

import { Logomark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * Layout pieces shared by every auth surface (the /sign-in page, the
 * auth modal, /onboarding), after the Vercel / ElevenLabs / ChatGPT
 * logins: one narrow column, the mark, one heading, then the controls.
 * Full-width buttons are right here and only here — the column is
 * already as narrow as a button (DESIGN_SYSTEM.md § Controls).
 */

/** Full-page frame: the mark links home, the column sits in the upper third. */
export function AuthPage({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center px-4">
      <main className="mz-enter flex w-full max-w-[22rem] flex-1 flex-col pt-[max(4rem,14svh)] pb-10">
        <Link
          href="/"
          aria-label="Materialize — home"
          className="mx-auto mb-8 rounded-md text-foreground transition-opacity duration-150 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Logomark height={28} />
        </Link>
        {children}
      </main>
      {footer && <div className="pb-6">{footer}</div>}
    </div>
  );
}

/** The one heading of an auth step, with an optional line under it. */
export function AuthHeading({
  title,
  description,
  as: Tag = "h1",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={cn("mb-6 text-center", className)}>
      <Tag className="text-2xl leading-7 font-semibold text-balance">
        {title}
      </Tag>
      {description && (
        <p className="mt-2 text-sm leading-5 text-pretty text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

/** Hairline with a centred "or" between social and email sign-in. */
export function AuthDivider() {
  return (
    <div
      className="flex items-center gap-3 text-xs text-subtle-foreground"
      role="separator"
    >
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Quiet text button for secondary auth actions ("Use a password"). */
export function AuthTextButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "mx-auto block w-fit cursor-pointer rounded-md px-1.5 py-1 text-[13px] leading-[18px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Terms line under the form. */
export function AuthLegal({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "text-center text-xs leading-[18px] text-subtle-foreground",
        className,
      )}
    >
      By continuing you agree to the{" "}
      <Link
        href="/terms"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Terms
      </Link>{" "}
      and{" "}
      <Link
        href="/privacy"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}
