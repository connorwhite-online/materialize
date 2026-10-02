"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Frown } from "@/components/icons/frown";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/page";

/**
 * Shared body for every `error.tsx` boundary. Shows a friendly sentence
 * rather than `error.message`: in production Next replaces server errors
 * with a generic "An error occurred in the Server Components render…"
 * string, so echoing it told people nothing and looked broken. The
 * digest stays visible (small, selectable) so a report can be matched
 * to the server log.
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
  description = "That didn't load. Give it another try — if it keeps happening, we're on it.",
  fallback,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  fallback?: { href: string; label: string };
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      icon={<Frown size={28} />}
      title={title}
      description={
        <>
          {description}
          {error.digest && (
            <span className="mt-3 block font-mono text-xs text-muted-foreground/70 select-all">
              Ref {error.digest}
            </span>
          )}
        </>
      }
      actions={
        <>
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          {fallback && (
            <Button
              size="lg"
              variant="outline"
              render={<Link href={fallback.href} />}
            >
              {fallback.label}
            </Button>
          )}
        </>
      }
    />
  );
}
