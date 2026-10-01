import Link from "next/link";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

/**
 * Shared shell for /privacy, /terms and /support: a readable column,
 * the page title, the last-updated line, and links to the sibling
 * pages. Plain server markup — these pages are fetched by directory
 * reviewers and crawlers with no session, so nothing here may depend
 * on auth or client JS.
 */
export function LegalPage({
  title,
  showUpdated = true,
  children,
}: {
  title: string;
  showUpdated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-10 pb-24 sm:pt-16">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {showUpdated && (
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {LEGAL_LAST_UPDATED}
        </p>
      )}
      <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-foreground/90 [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <nav
        aria-label="Legal"
        className="mt-16 flex gap-6 border-t pt-6 text-sm text-muted-foreground"
      >
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/support" className="hover:text-foreground">
          Support
        </Link>
      </nav>
    </main>
  );
}
