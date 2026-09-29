"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  // The anon landing is dark-only: the enclosure stage is lit as a warm
  // studio set, which reads right against near-black. Signed-in users on
  // `/` get their dashboard and keep their own theme. ClerkProvider seeds
  // auth state into the server render.
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  // `!== true`, not `=== false`: while Clerk is still loading (or never
  // loads, as on a phone that blocks it) isSignedIn is undefined, and the
  // landing rendered light.
  const forcedTheme =
    pathname === "/" && isSignedIn !== true ? "dark" : undefined;
  return (
    <NextThemesProvider
      forcedTheme={forcedTheme}
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
