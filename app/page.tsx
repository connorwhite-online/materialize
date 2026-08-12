import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthNav } from "@/components/auth/auth-nav";
import { Logomark } from "@/components/icons/logomark";
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

// PP Playground Light (--font-script) used to be declared here for the
// "Anything" word in the old wordmark hero. The hero is now a sentence
// in the standard heading face, so nothing referenced the script font
// any more and the 157KB OTF preload came off the landing page with it.
// The file is still in /public if a future design wants it back.

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
        {/* Header carries the brand now. The old hero's <h1> WAS the
            wordmark, so with the heading rewritten to a sentence the
            page would otherwise render the word "Materialize" nowhere
            above the fold — bad for a brand whose whole problem is
            being confused with four similarly-named companies. The
            logomark is an inline SVG (currentColor, no request). */}
        <header>
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <Link
              href="/"
              aria-label="Materialize — home"
              className="flex items-center text-foreground transition-opacity hover:opacity-70"
            >
              <Logomark height={18} />
            </Link>
            <AuthNav />
          </div>
        </header>

        {/* Bottom padding reserves vertical room for the fixed
            HomeBottomBar (search + explore + upload). */}
        <main className="flex flex-1 flex-col pb-44 sm:pb-40">
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex w-full max-w-2xl flex-col items-center gap-4 text-center">
              {/* Real, selectable <h1> — states what the product does
                  rather than spelling the brand. No inline fontFamily:
                  globals.css already routes every heading through
                  --font-heading (PP Frama), so this needs no font of
                  its own and adds no webfont to the critical path. */}
              <h1 className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl">
                Print in any material, and share your ideas
              </h1>
              <p className="max-w-lg text-pretty text-base leading-relaxed text-muted-foreground">
                Upload a model, pick from 60+ materials, and we print and ship
                it — no printer required. Browse designs from other makers, or
                publish your own and earn on every print.
              </p>
            </div>
          </div>

          {/* ─── Visual slot ───────────────────────────────────────────
              The three.js / R3F hero showcase used to mount here and was
              the single heaviest thing on the anon landing page. It is
              unmounted, not deleted: components/home/hero-showcase*.tsx,
              showcase-mesh.tsx, showcase-particles.tsx and
              material-carousel.tsx are all still in the tree, and
              re-adding <HeroShowcase /> here restores the old behavior
              in one line.

              Whatever replaces it should keep the two properties that
              made the old mount safe: load it through
              hero-showcase-lazy.tsx's next/dynamic + `ssr: false`
              wrapper so three.js stays off the critical path, and give
              the placeholder the same reserved height as the real
              canvas so its arrival doesn't shift the copy above it.
              ────────────────────────────────────────────────────────── */}
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
