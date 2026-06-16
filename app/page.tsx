import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import localFont from "next/font/local";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase-lazy";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";
import { HomeMarketing } from "@/components/home/home-marketing";

// PP Playground Light — scoped to the home page so the 157KB OTF is
// only preloaded here, not on every route (CON-166). Applied to the
// "Anything" word in the hero <h1> via the --font-script CSS variable.
const playground = localFont({
  src: "../public/PPPlayground-Light.otf",
  variable: "--font-script",
  display: "swap",
});

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
    <div className={`flex flex-col ${playground.variable}`}>
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
              {/* Real, selectable <h1> — the visible brand lockup IS
                  the heading now. It was previously an aria-hidden SVG
                  wordmark, which left the page heading-less for
                  crawlers and assistive tech. "Materialize" in the
                  display face, "Anything" in the script face, using
                  the same gradient/clip treatment as the nav brand. */}
              <h1 className="flex flex-col items-center justify-center gap-0 text-center leading-[0.95] sm:flex-row sm:items-baseline sm:gap-3">
                <span
                  className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-6xl tracking-tight text-transparent sm:text-7xl lg:text-8xl"
                  style={{
                    fontFamily: "var(--font-display), system-ui, sans-serif",
                  }}
                >
                  Materialize
                </span>
                <span
                  className="bg-gradient-to-b from-primary to-muted-foreground bg-clip-text text-6xl font-light text-transparent sm:text-7xl lg:text-8xl"
                  style={{ fontFamily: "var(--font-script), cursive" }}
                >
                  Anything
                </span>
              </h1>
              <p className="max-w-md text-balance text-center text-base leading-relaxed text-muted-foreground">
                The marketplace for 3D-print files — browse and buy designs, or
                get any model printed on demand and shipped to your door.
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
