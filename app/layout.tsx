import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
import "./globals.css";
import { AuthModalProvider } from "@/components/auth/auth-modal";
import { ThemeProvider } from "@/components/theme-provider";
import { PendingPrintFileProvider } from "@/components/upload/pending-print-file";

// Display + script faces for the hero wordmark — both loaded as
// local OTF files from /public. Body text stays on the system
// font stack (set in globals.css).
//
// PP Fuji Bold — Pangram Pangram's chunky modernist display face,
// used for "Materialize" and the nav brand logo on app pages.
const fuji = localFont({
  src: "../public/PPFuji-Bold.otf",
  variable: "--font-display",
  display: "swap",
});
// PP Playground Light — Pangram Pangram's script, used for
// "Anything" in the home hero wordmark.
const playground = localFont({
  src: "../public/PPPlayground-Light.otf",
  variable: "--font-script",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Materialize",
  description:
    "A marketplace for 3D print files with integrated on-demand printing",
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
        className={`${fuji.variable} ${playground.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <body className="min-h-full flex flex-col">
          <ThemeProvider>
            <AuthModalProvider>
              <PendingPrintFileProvider>{children}</PendingPrintFileProvider>
            </AuthModalProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
