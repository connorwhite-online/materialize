"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MetaballLoader } from "@/components/ui/metaball-loader";

/**
 * Global page-transition loader overlay.
 *
 * Shows a centered metaball loader whenever a route transition is in flight.
 * Wired into the root layout so it spans all routes. Fades in/out smoothly.
 */
export function PageTransitionLoader() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isVisible, setIsVisible] = useState(false);

  // Fade in when transition starts, fade out when it completes
  useEffect(() => {
    setIsVisible(isPending);
  }, [isPending]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm transition-opacity duration-300 pointer-events-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      aria-hidden={!isVisible}
    >
      <div className="text-foreground">
        <MetaballLoader size={64} count={5} spin={4.5} breath={1.8} />
      </div>
    </div>
  );
}
