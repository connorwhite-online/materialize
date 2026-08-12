import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import localFont from "next/font/local";
import { AuthNav } from "@/components/auth/auth-nav";
import { HeroShowcase } from "@/components/home/hero-showcase-lazy";
import { HomeBottomBar } from "@/components/home/home-bottom-bar";
import { HomeMarketing } from "@/components/home/home-marketing";
import { HOME_FAQ } from "@/lib/seo/home-faq";
import {
  faqPageJsonLd,
  organizationJsonLd,
  safeJsonLdScript,
  webSiteJsonLd,
} from "@/lib/seo/json-ld";

/**
 * Home-page metadata. This route had none, so the most valuable title
 * tag on the site was inheriting the layout default — a bare
 * "Materialize", which is the one query we cannot win. "Materialize"
 * alone is contested by Materialise NV / i.materialise (also 3D
 * printing), the Materialize streaming database, and the Materialize
 * CSS framework, all with years of authority on us.
 *
 * `title.absolute` rather than a plain string: the root layout applies
 * a `%s · Materialize` template, so a plain string here would render
 * "… · Materialize · Materialize". `absolute` opts this one route out
 * of the template while leaving it in force everywhere else.
 *
 * The title leads with the brand (so a navigational "materialize.cc"
 * search resolves cleanly) and then states the category in the words
 * people search — "3D print files" and "3D printing" — inside the
 * ~60-character window Google renders before truncating.
 */
const HOME_TITLE =
  "Materialize — 3D Print Files Marketplace & On-Demand 3D Printing";

const HOME_DESCRIPTION =
  "Buy and sell 3D-print files, or upload any STL, OBJ, 3MF or STEP model and get it printed on demand in PLA, resin, nylon or metal by a vetted manufacturer and shipped to your door.";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  // Self-referencing canonical. Cheap insurance against the same
  // content being indexed under tracking params (?ref=, ?utm_*) that
  // inbound links and social shares append.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "/",
    siteName: "Materialize",
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

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
      {/* Site-level structured data. Only the home page emits these:
          Organization and WebSite are singletons keyed by `@id`, and
          repeating them on every route gives a crawler N competing
          copies of the same entity to reconcile. FAQPage is tied to the
          visible <HomeFaq /> rendered inside <HomeMarketing /> below —
          both read from HOME_FAQ so the marked-up answers and the
          on-screen answers cannot drift. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdScript(organizationJsonLd()),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdScript(webSiteJsonLd()),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLdScript(faqPageJsonLd(HOME_FAQ, "/")),
        }}
      />

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
