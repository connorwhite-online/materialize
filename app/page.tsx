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

      <main className="flex-1 flex flex-col pb-40">
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-5xl flex flex-col items-center">
            <HeroShowcase />
          </div>
        </div>
      </main>

      {/* Fixed bottom: Explore materials + search + upload */}
      <HomeBottomBar />
    </div>
  );
}
