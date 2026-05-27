"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PrintError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="mt-2 text-muted-foreground">
        {error.message || "Failed to load the print page"}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/print" />}>
          Start over
        </Button>
      </div>
    </div>
  );
}
