import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthNav } from "@/components/auth/auth-nav";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // If the user is signed in but hasn't picked a username yet, send them to onboarding
  const user = await currentUser();
  if (user && !user.username) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Materialize
            </Link>
            <nav className="hidden items-center gap-4 text-sm md:flex">
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
                href="/dashboard"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Dashboard
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
    </div>
  );
}
