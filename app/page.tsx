import Link from "next/link";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";

export default async function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Minimal header */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <span className="text-lg font-semibold tracking-tight">
            Materialize
          </span>
          <AuthNav />
        </div>
      </header>

      <main className="flex-1 flex flex-col pb-32">
        {/* Hero: 3D mesh + material carousel + explore link */}
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl flex flex-col items-center gap-3">
            <HeroShowcase />
            <Link
              href="/materials"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Explore materials &rarr;
            </Link>
          </div>
        </div>
      </main>

      {/* Fixed bottom search + upload */}
      <HomeBottomBar />
    </div>
  );
}
