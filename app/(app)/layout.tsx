import Link from "next/link";
import { AuthNav } from "@/components/auth/auth-nav";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";

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
            <div className="flex items-baseline gap-6">
              <Link
                href="/"
                className="text-xl tracking-tight bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent"
                style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}
              >
                Materialize
              </Link>
              <nav className="hidden items-baseline gap-4 text-sm md:flex">
                <Link
                  href="/files"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Browse
                </Link>
                <Link
                  href="/materials"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Materials
                </Link>
                <Link
                  href="/print"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Print
                </Link>
              </nav>
            </div>
            <AuthNav />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <CartPanel />
      </div>
    </CartProvider>
  );
}
