import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-foreground/10 bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Materialize
            </Link>
            <nav className="hidden items-center gap-4 text-sm md:flex">
              <Link
                href="/files"
                className="text-foreground/60 transition-colors hover:text-foreground"
              >
                Browse
              </Link>
              <Link
                href="/materials"
                className="text-foreground/60 transition-colors hover:text-foreground"
              >
                Materials
              </Link>
              <Link
                href="/dashboard"
                className="text-foreground/60 transition-colors hover:text-foreground"
              >
                Dashboard
              </Link>
              <Link
                href="/print"
                className="text-foreground/60 transition-colors hover:text-foreground"
              >
                Print
              </Link>
            </nav>
          </div>
          <UserButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
