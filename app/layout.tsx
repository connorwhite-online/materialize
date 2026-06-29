import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
import "./globals.css";
import { MotionConfig } from "motion/react";
import { AuthModalProvider } from "@/components/auth/auth-modal";
import { ThemeProvider } from "@/components/theme-provider";
import { PendingPrintFileProvider } from "@/components/upload/pending-print-file";
import { Iterate } from "iterate-ui-next/devtools";

// Display face for the hero wordmark — loaded as a local OTF from
// /public. Body text stays on the system font stack (globals.css).
//
// PP Fuji Bold — Pangram Pangram's chunky modernist display face,
// used for "Materialize" and the nav brand logo on app pages.
const fuji = localFont({
  src: "../public/PPFuji-Bold.otf",
  variable: "--font-display",
  display: "swap",
});
// PP Frama — the new app typeface (Pangram Pangram). Regular (--font-frama)
// drives the heading font (--font-heading in globals.css), so the existing
// `font-heading` utility across the UI (card / dialog / alert / section
// titles) renders in Frama Regular. A single 400 face means medium/heading
// weights collapse to Regular — the intended "Regular for headings" look.
// (The Black cut previously powered the nav wordmark, now replaced by the
// <Logomark /> SVG, so it's no longer loaded.)
const framaRegular = localFont({
  src: "../public/PPFrama-Regular.otf",
  variable: "--font-frama",
  weight: "400",
  display: "swap",
});
// PP Playground Light (--font-script) is only used on the home hero
// ("Anything"). It is declared in app/page.tsx so the 157KB OTF is
// only preloaded on that route instead of every page. (CON-166)

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
const SITE_DESCRIPTION =
  "A marketplace for 3D print files with integrated on-demand printing";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

// Tell the browser the soft keyboard should overlay our layout
// instead of pushing the page up. The fixed bottom search bar
// then re-positions itself above the keyboard via the
// VisualViewport API in HomeBottomBar — that way iOS doesn't
// auto-scroll the document on input focus, and the hero
// stays put.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        className={`${fuji.variable} ${framaRegular.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col">
          <MotionConfig reducedMotion="user">
            <ThemeProvider>
              <AuthModalProvider>
                <PendingPrintFileProvider>{children}</PendingPrintFileProvider>
              </AuthModalProvider>
            </ThemeProvider>
          </MotionConfig>
          <Iterate />
        </body>
      </html>
    </ClerkProvider>
  );
}
