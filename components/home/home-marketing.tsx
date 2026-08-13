import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Browse } from "@/components/icons/browse";
import { Print } from "@/components/icons/print";
import { ImagePlus } from "@/components/icons/image-plus";
import { Factory } from "@/components/icons/factory";
import { Materials } from "@/components/icons/materials";
import { Code } from "@/components/icons/code";
import { ChevronRight } from "@/components/icons/chevron-right";
import { HomeFaq } from "@/components/home/home-faq";

/**
 * Below-the-fold marketing content for the anon home page.
 *
 * This is a server component on purpose. The hero above it is almost
 * entirely client-rendered (the SVG wordmark is aria-hidden, the 3D
 * showcase is `ssr: false`), so a crawler — or an AI agent fetching
 * raw HTML — gets a near-empty shell from the first screen. That hurts
 * both Google ranking and agent retrieval, and it's compounded by the
 * "Materialize" name colliding with a CSS framework, a streaming
 * database, and Materialise (the Belgian 3D-printing company).
 *
 * Shipping real, indexable copy + internal links into the catalog here
 * gives both audiences something to read and somewhere to go, and the
 * descriptive prose tells search engines this is a *3D-print
 * marketplace* — disambiguating it from the homonyms.
 */

const FEATURES = [
  {
    icon: Browse,
    title: "Browse & buy designs",
    body: "Discover thousands of 3D-print files — STL, OBJ, 3MF, and STEP — from independent creators. Buy a single model or grab free files to print yourself.",
    href: "/files",
    cta: "Browse the marketplace",
  },
  {
    icon: Print,
    title: "Print on demand",
    body: "Get an instant quote and order a physical print in PLA, resin, nylon, or metal from a vetted manufacturer. No printer required — it ships to your door.",
    href: "/materials",
    cta: "Explore materials",
  },
  {
    icon: ImagePlus,
    title: "Upload & sell",
    body: "Publish your own models, set a price or share them for free, and earn from every print and download. Keep the upside — we only take a 3% service fee.",
    href: "/sign-up",
    cta: "Start selling",
  },
] as const;

const BENEFITS = [
  {
    icon: Materials,
    title: "60+ materials & finishes",
    body: "From everyday PLA to titanium and multicolor resin, with finish and color options surfaced at quote time.",
  },
  {
    icon: Factory,
    title: "Vendor-backed quotes",
    body: "Live pricing from a network of vetted print shops via CraftCloud — you see real costs before you commit.",
  },
  {
    icon: ImagePlus,
    title: "Fair to creators",
    body: "A 3% service fee on print orders — 99\u00a2 minimum, never more than $5. No listing fees, no markup on your downloads.",
  },
  {
    icon: Code,
    title: "Agent-ready",
    body: "Queryable by AI agents through our MCP server and llms.txt — search the catalog and place print orders programmatically.",
  },
] as const;

export function HomeMarketing() {
  return (
    <div className="border-t border-border bg-muted/20">
      {/* Bottom padding used to clear the fixed HomeBottomBar; that
          bar is gone (search lives in the top bar now). */}
      <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
        {/* How it works */}
        <section aria-labelledby="how-it-works" className="space-y-3">
          <h2
            id="how-it-works"
            className="text-2xl font-bold leading-tight sm:text-3xl"
          >
            From a digital model to a printed part
          </h2>
          <p className="max-w-2xl text-pretty text-muted-foreground leading-relaxed">
            Materialize is a marketplace for 3D-print files with on-demand
            printing built in. Find a design, choose a material, and have it
            manufactured and shipped — or upload your own models and sell them.
          </p>
        </section>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title}>
                <CardContent className="flex h-full flex-col gap-3 px-5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon size={20} />
                  </span>
                  <h3 className="text-base font-semibold leading-tight">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.body}
                  </p>
                  <Link
                    href={f.href}
                    className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    {f.cta}
                    <ChevronRight size={14} />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Why Materialize */}
        <section aria-labelledby="why-materialize" className="mt-16 sm:mt-24">
          <h2
            id="why-materialize"
            className="text-2xl font-bold leading-tight sm:text-3xl"
          >
            Why makers and creators choose Materialize
          </h2>
          <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {BENEFITS.map((b) => {
              const Icon = b.icon;
              return (
                <div key={b.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
                    <Icon size={18} />
                  </span>
                  <div className="space-y-1">
                    <h3 className="font-semibold leading-tight">{b.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {b.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Q&A block. Carries the FAQPage JSON-LD emitted from
            app/page.tsx and gives the page substantive prose aimed at
            the long-tail queries the head term can't win. */}
        <HomeFaq />

        {/* Closing CTA — two authoritative internal links for crawlers
            and a clear next step for readers. */}
        <section className="mt-16 flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-8 sm:mt-24 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-xl font-bold leading-tight sm:text-2xl">
              Ready to print something?
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Browse community designs or pick a material to get an instant
              quote.
            </p>
          </div>
          <div className="flex shrink-0 gap-3">
            <Link
              href="/files"
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Browse files
              <ChevronRight size={14} />
            </Link>
            <Link
              href="/materials"
              className="inline-flex items-center gap-1 rounded-lg border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              View materials
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
