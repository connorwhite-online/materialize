import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/nav/top-bar";
import { AppShell } from "@/components/nav/app-shell";
import { HomeDashboard } from "@/components/home/home-dashboard";
import { HomeMarketing } from "@/components/home/home-marketing";
import { isSandboxMode } from "@/lib/env";
import { resolveTextToCadAccess } from "@/lib/features";
import { getMyUnreadNotificationCount } from "@/lib/notifications/queries";
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
  // Authed home is a jump-off dashboard (upload + pending orders +
  // recent files). Anon visitors keep the marketing hero below. A user
  // without a username is mid-onboarding — punt them there so we don't
  // render a logged-in shell over an incomplete account.
  const { userId } = await auth();
  if (userId) {
    const user = await currentUser();
    if (!user?.username) {
      redirect("/onboarding");
    }

    const [textToCad, sandbox, initialUnreadCount] = await Promise.all([
      resolveTextToCadAccess(),
      Promise.resolve(isSandboxMode()),
      getMyUnreadNotificationCount(),
    ]);

    return (
      <AppShell
        initialUnreadCount={initialUnreadCount}
        sandbox={sandbox}
        textToCad={textToCad}
      >
        <HomeDashboard userId={userId} />
      </AppShell>
    );
  }

  // Anon landing: no sandbox flag needed here. The badge lives on the
  // checkout surfaces now (components/sandbox-context.tsx), and nothing
  // an anon visitor sees on this page takes payment.
  const textToCad = await resolveTextToCadAccess();

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

      <TopBar initialUnreadCount={0} textToCad={textToCad} alwaysVisible />

      {/* Hero — exactly one screen. min-h-dvh (not h-dvh) keeps the
          hero at one mobile viewport while letting HomeMarketing below
          grow the page. dvh, not vh: 100vh on iOS Safari includes the
          URL-bar area, so the hero would come out taller than what's
          actually visible; dvh tracks URL-bar visibility. */}
      <section className="flex min-h-dvh flex-col">
        {/* Brand mark lives in TopBar so "Materialize" still appears
            above the fold. The h1 states what the product does. */}
        <main className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex w-full max-w-2xl flex-col items-center gap-4 text-center">
              {/* Real, selectable <h1> — states what the product does
                  rather than spelling the brand. Same system stack as
                  the rest of the app; no webfont on the critical path. */}
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
    </div>
  );
}
