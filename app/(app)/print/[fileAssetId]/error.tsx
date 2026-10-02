"use client";

import { RouteError } from "@/components/route-error";

export default function PrintConfigError({
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
      title="Print options didn't load"
      fallback={{ href: "/print", label: "Back to Print" }}
    />
  );
}
