import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase-lazy";
import { HeroWordmark } from "@/components/home/hero-wordmark";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";
import { HomeMarketing } from "@/components/home/home-marketing";

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

  // The page now scrolls: a full-viewport hero followed by
  // server-rendered marketing sections. The outer container is plain
  // flow (no h-dvh / overflow-hidden) so the content below the fold
  // can extend it.
  return (
    <div className="flex flex-col">
      {/* Hero — exactly one screen. min-h-dvh (not h-dvh) keeps the
          hero at one mobile viewport while letting HomeMarketing below
          grow the page. dvh, not vh: 100vh on iOS Safari includes the
          URL-bar area, so the hero would come out taller than what's
          actually visible; dvh tracks URL-bar visibility. */}
      <section className="flex min-h-dvh flex-col">
        {/* Minimal header — auth nav only, no border, no brand
            text. The hero wordmark below serves as the brand. */}
        <header>
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-end px-4">
            <AuthNav />
          </div>
        </header>

        {/* Bottom padding reserves vertical room for the fixed
            HomeBottomBar (search + explore + upload). */}
        <main className="flex flex-1 flex-col pb-44 sm:pb-40">
          <div className="flex flex-1 items-end justify-center px-4">
            <div className="w-full max-w-5xl flex flex-col items-center gap-2">
              {/* Real <h1> for crawlers and assistive tech. The visible
                  "Materialize Anything" lockup is an aria-hidden SVG
                  wordmark, so without this the home page — the one URL
                  every backlink points at — would ship no heading and
                  no descriptive text at all. sr-only keeps the visual
                  hero unchanged while giving search/agents real text
                  (and helps disambiguate the contested name). */}
              <h1 className="sr-only">
                Materialize Anything — a 3D-print marketplace with on-demand
                printing
              </h1>
              {/* Wordmark sits in normal flow above the canvas on every
                  viewport. We had it absolutely positioned behind the
                  canvas previously (so the torus floated through the
                  glyphs), but the overlap was decorative-only and the
                  extra height on mobile caused the page to scroll a
                  hair. Keeping the typography simple and stacked. */}
              <HeroWordmark />
              <p className="max-w-xl text-balance text-center text-sm text-muted-foreground leading-relaxed sm:text-base">
                Upload and sell 3D-print files, browse thousands of designs, and
                order a physical print in PLA, resin, nylon, or metal from a
                vetted manufacturer — shipped to your door.
              </p>
              <HeroShowcase />
            </div>
          </div>
        </main>
      </section>

      {/* Below the fold: server-rendered features + benefits + internal
          links so crawlers and agents get real content, not the
          JS-only hero shell. */}
      <HomeMarketing />

      {/* Fixed bottom: Explore materials + search + upload. Stays
          pinned over the scrolling content as a persistent CTA. */}
      <HomeBottomBar />
    </div>
  );
}
