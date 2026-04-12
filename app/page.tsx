import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase";

export default async function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Minimal header */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <span className="text-lg font-semibold tracking-tight">
            Materialize
          </span>
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/materials"
              className="text-muted-foreground transition-colors hover:text-foreground hidden sm:inline"
            >
              Materials
            </Link>
            <Link
              href="/files"
              className="text-muted-foreground transition-colors hover:text-foreground hidden sm:inline"
            >
              Browse
            </Link>
            <AuthNav />
          </nav>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {/* Hero: 3D mesh + material carousel */}
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl">
            <HeroShowcase />
          </div>
        </div>

        {/* Search + CTAs at bottom */}
        <div className="mx-auto w-full max-w-2xl px-4 pb-12">
          <form action="/files" method="GET">
            <div className="relative">
              <input
                name="q"
                type="text"
                placeholder="Search files, materials, creators..."
                className="w-full rounded-xl border border-border bg-background px-5 py-3.5 text-sm shadow-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Search
              </button>
            </div>
          </form>

          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              render={<Link href="/materials" />}
            >
              Explore materials
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              render={<Link href="/dashboard/uploads/new" />}
            >
              Upload file
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
