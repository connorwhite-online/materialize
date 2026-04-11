"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 text-center">
      <h2 className="text-xl font-semibold">Dashboard Error</h2>
      <p className="mt-2 text-muted-foreground">
        {error.message || "Failed to load dashboard data"}
      </p>
      <Button variant="outline" onClick={reset} className="mt-6">
        Try again
      </Button>
    </div>
  );
}
