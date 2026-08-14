import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/nav/top-bar";
import { AppShell } from "@/components/nav/app-shell";
import { MobileNav } from "@/components/nav/mobile-nav";
import { HeroBackground } from "@/components/home/hero-background";
import { HomeDashboard } from "@/components/home/home-dashboard";
import { HomeMarketing } from "@/components/home/home-marketing";
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

  // The page now scrolls: a full-viewport hero followed by
  // server-rendered marketing sections. The outer container is plain
  // flow (no h-dvh / overflow-hidden) so the content below the fold
  // can extend it.
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
          on small screens — anon home matches authed routes. */}
      <TopBar initialUnreadCount={0} textToCad={textToCad} />

      {/* Hero — exactly one screen. h-svh (not min-h-dvh / 100vh):
          iOS 26 Safari changed `vh` to window.outerHeight (chrome
          collapsed) in every tab mode, and the Liquid Glass toolbar
          overlays the layout viewport. `dvh` still tracks hide/show
          but first paint in Bottom tab mode is the LARGE size, so a
          100dvh hero is taller than what's visible and the next
          section peeks under the toolbar. `svh` is the chrome-expanded
          height — the first screen the visitor actually sees. Siblings
          below (HomeMarketing) still grow the page; TopBar is fixed.

          Background art covers this first screen (absolute inset-0 +
          object-cover). The three.js / R3F showcase that used to sit
          in a visual slot below the copy is unmounted, not deleted —
          hero-showcase*.tsx et al. stay in the tree. */}
      <section className="relative isolate flex h-svh w-full flex-col overflow-hidden">
        <HeroBackground />
        {/* Brand mark lives in TopBar so "Materialize" still appears
            above the fold. The h1 states what the product does. */}
        <main className="relative z-10 flex flex-1 flex-col">
          {/* Mobile: copy below center, padded above the floating pill
              (`fixed bottom-6` + h-14). Top-aligned sat in the light
              beam and the muted subheading disappeared against it.
              Desktop (nav+): vertically centered, left-aligned with
              generous padding so it clears the sculpture. */}
          <div className="flex flex-1 items-end justify-start px-6 pb-32 sm:px-8 nav:items-center nav:px-16 nav:pb-0 lg:px-24 xl:px-32">
            <div className="flex w-full max-w-xl flex-col items-start gap-4 text-left">
              {/* Real, selectable <h1> — states what the product does
                  rather than spelling the brand. Same system stack as
                  the rest of the app; no webfont on the critical path. */}
              <h1 className="text-balance text-3xl leading-[1.1] tracking-tight sm:text-4xl">
                Print anything, share your ideas
              </h1>
              <p className="max-w-lg text-pretty text-base leading-relaxed text-foreground/90 [text-shadow:0_0_18px_var(--background),0_1px_2px_var(--background)]">
                Get prints delivered to your door, and pick from 60+ materials.
                Share your hardware projects and files.
              </p>
            </div>
          </div>
        </main>
      </section>

      {/* Below the fold: server-rendered features + benefits + internal
          links so crawlers and agents get real content, not the
          JS-only hero shell. pb-28 clears the floating mobile nav. */}
      <div className="pb-28 nav:pb-0">
        <HomeMarketing />
      </div>

      <MobileNav initialUnreadCount={0} textToCad={textToCad} />
      <CartPanel />
    </CartProvider>
  );
}
