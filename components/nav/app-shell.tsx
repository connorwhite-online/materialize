import type { ReactNode } from "react";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
import { TopBar } from "@/components/nav/top-bar";
import { MobileNav } from "@/components/nav/mobile-nav";

/**
 * Shared authed chrome: top bar at nav+, the morphing mobile nav
 * pill below that, cart panel. Used by `app/(app)/layout.tsx` and the authed branch of
 * `/` (which lives outside the (app) route group).
 */
export function AppShell({
  initialUnreadCount,
  sandbox,
  textToCad,
  children,
}: {
  initialUnreadCount: number;
  sandbox: boolean;
  textToCad: boolean;
  children: ReactNode;
}) {
  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col">
        <TopBar
          initialUnreadCount={initialUnreadCount}
          sandbox={sandbox}
          textToCad={textToCad}
        />
        <main className="flex-1 pb-28 nav:pb-0 nav:pt-16">{children}</main>
        <MobileNav
          initialUnreadCount={initialUnreadCount}
          textToCad={textToCad}
          sandbox={sandbox}
        />
        <CartPanel />
      </div>
    </CartProvider>
  );
}
