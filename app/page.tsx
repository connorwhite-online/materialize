import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/nav/top-bar";
import { AppShell } from "@/components/nav/app-shell";
import { MobileNav } from "@/components/nav/mobile-nav";
import { HomeDashboard } from "@/components/home/home-dashboard";
import { HomeFaq } from "@/components/home/home-faq";
import { EnclosureStage } from "@/components/landing/enclosure-stage-lazy";
import { LandingProvider } from "@/components/landing/landing-context";
import { LandingFooter } from "@/components/landing/landing-footer";
import {
  HeroCarousel,
  HeroWord,
  LandingHero,
} from "@/components/landing/landing-hero";
import { CartProvider } from "@/components/print/cart-context";
import { CartPanel } from "@/components/print/cart-panel";
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

  // Plain document scroll: four screen-high sections over a fixed
  // enclosure canvas, then the footer.
  return (
    <CartProvider>
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

      {/* Same chrome as AppShell, minus sandbox: TopBar hides below
          `nav` (no alwaysVisible) and the morphing MobileNav takes over
          on small screens. */}
      <LandingProvider>
        <TopBar landing initialUnreadCount={0} textToCad={textToCad} />

        {/* The Pneuma Q enclosure is one fixed canvas behind every section;
          scrolling between [data-landing-section] screens drives its
          choreography (components/landing/choreography.ts):
          hero carousel → shells split with file labels → exploded BOM →
          zoomed backdrop under the FAQ. Copy stays short — the model
          does the showing. */}
        <EnclosureStage />

        <LandingHero>
          <main className="flex flex-1 items-end justify-start px-6 pb-28 sm:px-8 nav:px-16 nav:pb-24 lg:px-24 lg:pb-28 xl:px-32">
            <div className="flex w-full max-w-xl flex-col items-start gap-4 text-left">
              {/* Real, selectable <h1>. The server renders "anything"; the
                intro only swaps the word client-side and rests back on it. */}
              <h1 className="text-2xl leading-[1.1] tracking-tight sm:text-4xl">
                Print <HeroWord />,
                <br />
                share your ideas
              </h1>
              <p className="max-w-lg text-pretty text-base leading-relaxed text-foreground/90">
                Get prints delivered to your door, and pick from 60+ materials.
                Share your hardware projects and files.
              </p>
              <HeroCarousel />
            </div>
          </main>
        </LandingHero>

        <section
          data-landing-section
          className="pointer-events-none relative z-10 flex h-svh flex-col justify-start px-6 pt-28 sm:px-8 nav:px-16 lg:px-24 xl:px-32"
        >
          <h2 className="text-2xl tracking-tight sm:text-4xl">
            Share your files
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            Publish the parts. Anyone can download or print them.
          </p>
        </section>

        <section
          data-landing-section
          className="pointer-events-none relative z-10 flex h-svh flex-col justify-start px-6 pt-28 sm:px-8 nav:px-16 lg:px-24 xl:px-32"
        >
          <h2 className="text-2xl tracking-tight sm:text-4xl">
            Host the whole build
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            Every part, with its bill of materials.
          </p>
        </section>

        {/* FAQ floats over the zoomed enclosure. The visible answers back
          the FAQPage JSON-LD above — both read HOME_FAQ. */}
        <section
          data-landing-section
          className="relative z-10 flex min-h-svh items-center px-3 py-24 sm:px-8"
        >
          <div className="glass-surface mx-auto w-full max-w-5xl rounded-3xl p-5 ring-1 ring-border/70 sm:p-10">
            <HomeFaq className="mt-0 border-t-0 pt-0 sm:mt-0 sm:pt-0" />
          </div>
        </section>

        <LandingFooter />

        <MobileNav initialUnreadCount={0} textToCad={textToCad} />
        <CartPanel />
      </LandingProvider>
    </CartProvider>
  );
}
