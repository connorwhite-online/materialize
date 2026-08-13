"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether this deployment is running against Stripe test keys and/or a
 * mocked CraftCloud. Resolved server-side by `isSandboxMode()` in
 * `lib/env.ts` (which reads `process.env`, so a client component can
 * never compute it) and handed to the tree once, by `AppShell`.
 *
 * The flag used to ride the nav as a permanent amber chip. It lives
 * here instead because it only earns its space at the moment money is
 * supposed to move — the checkout surfaces read it with `useSandbox()`
 * and say so there, rather than badging every page of the app.
 */
const SandboxContext = createContext(false);

export function SandboxProvider({
  sandbox,
  children,
}: {
  sandbox: boolean;
  children: ReactNode;
}) {
  return (
    <SandboxContext.Provider value={sandbox}>
      {children}
    </SandboxContext.Provider>
  );
}

/**
 * Defaults to `false` outside a provider, so a checkout surface
 * rendered in isolation (tests, storybook-style harnesses) degrades to
 * "live" rather than crying sandbox at a real customer.
 */
export function useSandbox(): boolean {
  return useContext(SandboxContext);
}
