"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MetaballLoader } from "@/components/ui/metaball-loader";

/**
 * Global page-transition loader overlay.
 *
 * Shows a centered metaball loader whenever a route transition is in flight.
 * Detects navigation via usePathname change, fades the overlay in/out.
 * Wired into the root layout so it spans all routes.
 */
export function PageTransitionLoader() {
  const pathname = usePathname();
  const prevPathname = useRef<string>();
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // On first mount, initialize the ref but don't show loader
    if (prevPathname.current === undefined) {
      prevPathname.current = pathname;
      return;
    }

    // Pathname changed — navigation occurred
    if (prevPathname.current !== pathname) {
      setIsVisible(true);

      // Clear any pending fade timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Fade out after a brief delay to show the loader briefly,
      // then let it hide. The overlay is pointer-events-none so it
      // doesn't block interaction.
      timeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 300);

      prevPathname.current = pathname;
    }
  }, [pathname]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

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
