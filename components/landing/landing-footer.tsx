import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";

/**
 * Footer that closes the anon landing: its own glass card under the FAQ
 * card, same width (app/page.tsx). It also
 * carries the internal links the old marketing block used to — the
 * crawlable routes into the catalog shouldn't disappear with it.
 */
const COLUMNS = [
  {
    title: "Make",
    links: [
      { href: "/print", label: "Get a print quote" },
      { href: "/materials", label: "See all materials" },
    ],
  },
  {
    title: "Discover",
    links: [
      { href: "/files", label: "Browse files" },
      { href: "/sign-up", label: "Sell your designs" },
    ],
  },
  {
    title: "Agents",
    links: [{ href: "/llms.txt", label: "llms.txt" }],
  },
  {
    title: "Company",
    links: [
      { href: "/support", label: "Support" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
] as const;

export function LandingFooter() {
  return (
    <footer className="px-3 pb-28 sm:px-8 nav:pb-6">
      <div className="glass-surface mx-auto max-w-4xl rounded-3xl px-6 py-10 ring-1 ring-border/70 sm:px-10">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="flex flex-col gap-3">
            <Wordmark height={14} className="text-foreground" />
            <p className="max-w-xs text-sm text-muted-foreground">
              File hosting and on-demand printing in 200+ materials.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-8 sm:grid-cols-4"
          >
            {COLUMNS.map((col) => (
              <div key={col.title} className="flex flex-col gap-2.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {col.title}
                </p>
                {col.links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-sm text-foreground/90 hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <p className="mt-10 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Materialize
        </p>
      </div>
    </footer>
  );
}
