import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase-lazy";
import { HeroWordmark } from "@/components/home/hero-wordmark";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";

export default async function HomePage() {
  // Authed home = the user's own profile. Materialize is mostly a
  // personal-files tool, and the profile/dashboard is what they
  // come here to see. Anon visitors keep getting the marketing hero
  // below. A user without a username is mid-onboarding — punt them
  // there so we don't render a logged-in shell over an incomplete
  // account.
  const { userId } = await auth();
  if (userId) {
    const user = await currentUser();
    if (user?.username) {
      redirect(`/${user.username}`);
    }
    redirect("/onboarding");
  }

  // h-dvh, not h-screen: 100vh on iOS Safari includes the area the
  // URL bar occupies, so the page comes out taller than the actual
  // visible viewport whenever the bar is shown — the body then
  // scrolls a hair to absorb the difference even though our layout
  // is sized to fit. dvh follows the URL-bar visibility and matches
  // what's actually on screen.
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
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
