import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { MotionConfig } from "motion/react";
import { AuthModalProvider } from "@/components/auth/auth-modal";
import { ThemeProvider } from "@/components/theme-provider";
import { PendingPrintFileProvider } from "@/components/upload/pending-print-file";
import { PageTransitionLoader } from "@/components/nav/page-transition-loader";
import { Iterate } from "iterate-ui-next/devtools";

// Body text and headings share the system font stack (globals.css).
//
// PP Fuji Bold (--font-display) used to load here for the home hero
// wordmark. That banner is gone and the brand is an SVG now, so nothing
// consumes the variable and the OTF no longer ships to the browser on any
// route. lib/og/render-card.tsx still reads the same file off disk for OG
// cards — that path is server-side and unaffected.
//
// PP Frama Regular (--font-heading) used to load here for headings. The
// app is on a single system stack for now; the OTF stays in public/ but
// is not declared, so it doesn't download. Re-add a localFont() here if
// headings go back to Frama.
//
// PP Playground Light (--font-script) was scoped to the home hero
// ("Anything") in app/page.tsx (CON-166). The hero banner is gone, so it
// no longer loads anywhere.

// Site-wide defaults. Per-page `generateMetadata` overrides title,
// description, and og:image; everything else (twitter card type,
// metadataBase, default site name) cascades from here.
//
// `metadataBase` is the absolute origin Next uses to resolve relative
// og:image / twitter:image URLs. Reads from NEXT_PUBLIC_APP_URL in
// prod / preview; the fallback is the production domain (NOT
// localhost) because this drives the site-wide OG/Twitter tags and
// canonical base. NEXT_PUBLIC_* vars are inlined at build time, so a
// build where the var isn't present would otherwise bake
// `http://localhost:3000` into every link preview and og:url — which
// is exactly the leaked-dev-metadata symptom we've been bitten by.
// Mirror the same fallback the rest of the SEO surface uses
// (sitemap.ts, robots.ts, lib/seo/json-ld.ts, llms.txt).
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

const SITE_NAME = "Materialize";
// The fallback title for any route that doesn't set its own. It used to
// be the bare brand word, which is the single most contested string we
// could ship — "Materialize" is also Materialise NV / i.materialise (3D
// printing), a streaming database, and a CSS framework. Naming the
// category in the default means even an un-metadata'd route says what
// this site is. Routes that DO set a title get `%s · Materialize` via
// the template below; app/page.tsx opts out with `title.absolute`.
const DEFAULT_TITLE =
  "Materialize — 3D Print Files Marketplace & On-Demand 3D Printing";
const SITE_DESCRIPTION =
  "A marketplace for 3D-print files with on-demand 3D printing built in — buy and sell STL, OBJ, 3MF and STEP models, or get any model printed in PLA, resin, nylon or metal and shipped to your door.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  /**
   * Explicit indexing directives. Without these Next emits no `robots`
   * meta at all, which leaves Google on its conservative defaults:
   * ~160-character snippets and *thumbnail-sized* image previews.
   * `max-image-preview: large` is what makes a result eligible for the
   * big image treatment in mobile SERPs and Discover — for a visual
   * marketplace that is the difference between a text link and a
   * picture of the thing someone wants to print.
   *
   * Pages that must stay out of the index (dashboards, order flows,
   * not-found states) set `robots: { index: false }` in their own
   * generateMetadata, which overrides this.
   */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  /**
   * Search Console ownership. Set GOOGLE_SITE_VERIFICATION to the token
   * from the "HTML tag" verification method and redeploy — no code
   * change needed. Omitted entirely when unset so we don't emit an
   * empty meta tag.
   */
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? {
        verification: {
          google: process.env.GOOGLE_SITE_VERIFICATION,
        },
      }
    : {}),
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    startupImage: [
      { url: "/splash/splash-1320x2868.png", media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1320x2868-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1206x2622.png", media: "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1206x2622-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1290x2796.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1290x2796-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1179x2556.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1179x2556-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1284x2778.png", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1284x2778-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1170x2532-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1125x2436.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-1125x2436-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/splash/splash-750x1334.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/splash/splash-750x1334-dark.png", media: "(prefers-color-scheme: dark) and (device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
};

// Tell the browser the soft keyboard should overlay our layout
// instead of pushing the page up. Fixed bottom chrome (mobile tab
// bar, CAD composer) re-positions via the VisualViewport API so iOS
// doesn't auto-scroll the document on input focus.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Cover the iOS status-bar / home-indicator unsafe areas so the
  // anon-home photo can paint behind Liquid Glass chrome instead of
  // leaving a --background strip. Fixed bottom chrome adds
  // env(safe-area-inset-bottom) on top of its existing offset.
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className="h-full antialiased"
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col">
          <MotionConfig reducedMotion="user">
            <ThemeProvider>
              <AuthModalProvider>
                <PendingPrintFileProvider>{children}</PendingPrintFileProvider>
                <PageTransitionLoader />
              </AuthModalProvider>
            </ThemeProvider>
          </MotionConfig>
          <Iterate />
        </body>
      </html>
    </ClerkProvider>
  );
}
