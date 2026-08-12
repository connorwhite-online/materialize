import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AnimatedWordmark } from "@/components/brand/logo";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase-lazy";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";
import { HomeMarketing } from "@/components/home/home-marketing";

// PP Playground Light (--font-script) used to load here for the "Anything"
// word in the hero banner. The banner is gone, so the 157KB OTF no longer
// downloads at all — the file is still in /public if the script face is
// wanted again.

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
        {/* Minimal header — brand lockup and auth nav, no border. */}
        <header>
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
            {/* The lockup IS the page heading now that the hero banner is
                gone — it has to be an <h1> or the home page (the URL every
                backlink points at) ships heading-less to crawlers and
                assistive tech. The SVG is decorative; the sr-only text is
                what's actually read and indexed. */}
            <h1>
              <Link
                href="/"
                className="inline-flex text-foreground transition-opacity hover:opacity-80"
              >
                <AnimatedWordmark
                  animateOnMount
                  className="[--mz-h:15px] sm:[--mz-h:20px]"
                />
                <span className="sr-only">Materialize</span>
              </Link>
            </h1>
            <AuthNav />
          </div>
        </header>

        {/* Bottom padding reserves vertical room for the fixed
            HomeBottomBar (search + explore + upload). */}
        <main className="flex flex-1 flex-col pb-44 sm:pb-40">
          {/* items-center, not items-end: with the wordmark banner and its
              subtext gone the showcase is the only thing in the hero, so it
              centers in the viewport instead of hugging the bottom bar. */}
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="w-full max-w-5xl flex flex-col items-center gap-2">
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
