import Link from "next/link";
import { AuthNav } from "@/components/auth/auth-nav";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
import { MainMenuSidebar, MainMenuTrigger } from "@/components/nav/main-menu";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="text-xl tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent"
                style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
              >
                Materialize
              </Link>
              {/*
                Inline menu trigger — hidden at 2xl+ where the
                sidebar takes over. The trigger lives next to the
                logo so the affordance reads as part of the brand
                lockup rather than a separate UI region.
              */}
              <MainMenuTrigger />
            </div>
            <AuthNav />
          </div>
        </header>
        {/*
          Sidebar lives at the layout root, not nested inside <main>.
          fixed-positioned on the left, only renders at 2xl+ — at
          smaller widths it stays hidden and the dropdown trigger in
          the header carries the same nav. Anon home (app/page.tsx)
          uses its own layout and never sees this.
        */}
        <MainMenuSidebar />
        <main className="flex-1">{children}</main>
        <CartPanel />
      </div>
    </CartProvider>
  );
}
