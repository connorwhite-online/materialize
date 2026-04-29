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

      {/* Bottom padding reserves vertical room for the fixed
          HomeBottomBar (search + explore + upload). pb-44 on mobile
          is sized to fit the wordmark + canvas + carousel inside the
          remaining viewport on small phones without forcing scroll. */}
      <main className="flex-1 flex flex-col pb-44 sm:pb-40">
        <div className="flex-1 flex items-end justify-center px-4">
          <div className="w-full max-w-5xl flex flex-col items-center gap-2">
            {/* Wordmark sits in normal flow above the canvas on every
                viewport. We had it absolutely positioned behind the
                canvas previously (so the torus floated through the
                glyphs), but the overlap was decorative-only and the
                extra height on mobile caused the page to scroll a
                hair. Keeping the typography simple and stacked. */}
            <HeroWordmark />
            <HeroShowcase />
          </div>
        </div>
      </main>

      {/* Fixed bottom: Explore materials + search + upload */}
      <HomeBottomBar />
    </div>
  );
}
