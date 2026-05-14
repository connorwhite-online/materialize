"use client";

/**
 * App-router root error boundary. Catches errors in the root
 * layout itself (everything else falls into app/(app)/error.tsx),
 * including render errors that would otherwise blank-screen the
 * page.
 *
 * Sentry capture happens in a useEffect so the error report
 * survives even when React swaps the tree out. The visible
 * fallback is Next's stock `NextError statusCode={0}` — we
 * don't try to render a styled layout here because the broken
 * tree might be the layout itself.
 */
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
