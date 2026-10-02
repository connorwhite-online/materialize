"use client";

import { RouteError } from "@/components/route-error";

export default function FileDetailError({
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
      title="This file didn't load"
      fallback={{ href: "/files", label: "Browse files" }}
    />
  );
}
