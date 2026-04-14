import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase";
import { HeroWordmark } from "@/components/home/hero-wordmark";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";

export default async function HomePage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Minimal header — auth nav only, no border, no brand
          text. The hero wordmark below serves as the brand. */}
      <header>
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-end px-4">
          <AuthNav />
        </div>
      </header>

      {/* pb-56 on mobile leaves more bottom space so the hero
          sits higher; pb-40 on sm+ keeps the desktop spacing. */}
      <main className="flex-1 flex flex-col pb-56 sm:pb-40">
        <div className="flex-1 flex items-end justify-center px-4">
          {/* z-0 establishes a local stacking context so the
              wordmark's -z-10 stays below siblings here but above
              the page background. */}
          <div className="relative z-0 w-full max-w-5xl flex flex-col items-center">
            <HeroShowcase />
            {/* Wordmark sits BEHIND the canvas (-z-10). The
                canvas uses alpha:true so its non-torus pixels
                are transparent — the wordmark shows through
                everywhere except where the torus is actually
                drawn, which makes the torus appear to float
                in front of the letters. pointer-events-none
                lets drag/swipe pass straight through. */}
            <HeroWordmark className="absolute inset-x-0 -top-40 flex justify-center -z-10" />
          </div>
        </div>
      </main>

      {/* Fixed bottom: Explore materials + search + upload */}
      <HomeBottomBar />
    </div>
  );
}
