"use client";

import { RouteError } from "@/components/route-error";

export default function PrintError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="The print page hit a snag"
      fallback={{ href: "/print", label: "Start over" }}
    />
  );
}
