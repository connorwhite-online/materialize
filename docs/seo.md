# SEO: where we stand and what's left

Written Aug 2026, after the metadata pass in PR #190. This is the state of
search for materialize.cc, the reasoning behind what shipped, and — most
importantly — the owner-only work that no code change can substitute for.

## The two problems, which are not the same problem

"I can't find the site on Google" has two possible causes, and they need
completely different fixes:

1. **Indexed but ranking poorly** — Google has the pages, they're just
   buried. Fixed with on-page work, content, and links.
2. **Not indexed at all** — Google doesn't have the pages. There is no
   ranking to improve. Fixed only in Search Console.

Everything in PR #190 addresses (1). If we're actually in state (2), all
of it is inert until someone opens the door.

### Which state are we in?

**Unconfirmed.** The check run during that work — `site:materialize.cc`
through an agent's web-search tool — returned results only from
*other* domains (materialize.com, materializecss.com, materialise.com)
and nothing from ours. That reads as "zero pages indexed," but the tool
is not Google and may not honor the `site:` operator faithfully, so it's
a strong hint rather than a verdict.

**Confirm it properly in 30 seconds:** go to google.com and search
`site:materialize.cc`.

- "Your search did not match any documents" → state (2). Do the Search
  Console work below; it is the highest-value action available and
  nothing else matters until it's done.
- A list of our pages → state (1). The indexing work is already done;
  skip to *Ranking strategy*.

## Search Console setup (owner action — required)

Google finds new sites mainly by following links from sites it already
crawls. A domain with no inbound links can sit uncrawled indefinitely;
it is not in a queue somewhere waiting its turn. `robots.txt` and
`sitemap.xml` only tell a crawler what to do *once it arrives* — they
don't summon one. Search Console is the one channel that tells Google
directly that the site exists.

1. **Add the property** at <https://search.google.com/search-console>.
   Two property types, and the choice matters:

   - **Domain property** (recommended) — verified with a DNS TXT record
     at the registrar. Covers every subdomain and both protocols. This
     path does **not** use the `GOOGLE_SITE_VERIFICATION` env var.
   - **URL-prefix property** — can be verified with an HTML meta tag.
     This is what `GOOGLE_SITE_VERIFICATION` is wired for: set it in the
     Vercel project env, redeploy, then click Verify. The tag is emitted
     from `app/layout.tsx` § `metadata.verification` and is omitted
     entirely when the var is unset, so there's no empty tag in the
     meantime.

2. **Submit the sitemap** — Sitemaps section, enter `sitemap.xml`. This
   is how Google discovers listings, material pages, profiles and the
   category facets rather than stumbling onto them. See `app/sitemap.ts`
   for what's in it.

3. **Request indexing on `/`** — URL Inspection → *Request indexing*.
   Puts the homepage in a priority crawl queue instead of waiting on an
   organic crawl that may never come for a link-less domain.

4. **Then watch the Pages report** over the following days: what got
   indexed, what got excluded, and the stated reason for each exclusion.

## The brand-collision problem

This is the strategic constraint and it doesn't go away with better
metadata. "Materialize" collides with four established entities that
already own the SERP:

| Entity | Domain | Why it hurts |
| --- | --- | --- |
| **Materialise NV / i.materialise** | materialise.com | Belgian 3D-printing company, founded 1990, that *also* runs a 3D-print marketplace with on-demand printing. The collision is topical, not just lexical. |
| Materialize | materialize.com | Streaming database |
| MaterializeCSS | materializecss.com | CSS framework |
| Dogfalo/materialize | github.com | The repo for the same framework |

**We are not going to outrank Materialise NV on "materialize 3d
printing."** Thirty-five years of authority on a near-homophone of our
name, in our exact category. Any plan that depends on winning that query
is not a plan.

### Ranking strategy that follows from this

- **Win navigational queries decisively** — "materialize.cc",
  "materialize 3d print marketplace". Someone who has heard of us must
  find us instantly. This is what the keyworded titles and the
  `Organization` entity node are for.
- **Win long-tail, not head terms** — "3d print files for <category>",
  per-material queries ("titanium 3d printing service"), per-listing
  queries. We have programmatic surface area here that the competitors
  don't aim at: ~21 category facets, the full CraftCloud material
  catalog, and every published listing.
- **Be explicitly *not* the other four.** The `Organization` JSON-LD
  carries a `disambiguatingDescription` naming them outright, and the
  home FAQ answers "Is Materialize the same company as Materialise or
  i.materialise?" with a flat No. Both are deliberate; don't "clean them
  up."

## What shipped in PR #190

Merged Aug 2026. The single biggest find: **`app/page.tsx` had no
`metadata` export at all**, so the most valuable title tag on the site
was inheriting the layout default — a bare `<title>Materialize</title>`,
competing on brand alone against four giants.

- **Home metadata** — keyworded title via `title.absolute` (a plain
  string would pick up the layout's `%s · Materialize` template and
  double the brand), description, self-referencing canonical.
- **Site-level JSON-LD** (`lib/seo/json-ld.ts`) — `Organization` and
  `WebSite`, emitted only from the home page because both are
  `@id`-keyed singletons; repeating them elsewhere gives crawlers N
  competing copies of one entity. `WebSite` declares a `SearchAction`
  over `/files?q=` for sitelinks-search-box eligibility.
- **FAQ + `FAQPage` markup** — copy lives in `lib/seo/home-faq.ts`, read
  by *both* the JSON-LD and `<HomeFaq />`. Google requires marked-up
  answers to appear verbatim on the page; two hand-kept copies drift, so
  there is exactly one source. Never inline that copy into the component.
- **Root `app/opengraph-image.tsx`** — sharing materialize.cc itself used
  to render a bare text card. Leaf cards for files/projects/materials/
  profiles still win on their own routes.
- **`/files`, `/print` metadata; `/materials` title fix** — `/materials`
  read `title: "Materials | Materialize"` against the `%s · Materialize`
  template and was rendering `Materials | Materialize · Materialize`.
- **Browse index hygiene** — category facets are a finite curated set
  (`lib/categories`) that make real landing pages, so they're indexable
  with their own titles and are in the sitemap. Free-text `?q=` is an
  unbounded space of thin near-duplicates → `noindex, follow`, per
  Google's own guidance, so it stops eating a crawl budget we can't
  spare.
- **Robots directives** in `app/layout.tsx` with
  `max-image-preview: large`. Without it Google defaults to
  thumbnail-sized previews — for a visual marketplace that's the
  difference between a text link and a picture of the thing someone
  wants to print.

The landing hero was also rebuilt in the same PR (small centered `<h1>`
stating the offer, three.js showcase unmounted, 157KB script font
dropped). See AGENTS.md § Home landing page.

## Open items

**Owner actions:**

1. **Search Console** — the whole section above. Nothing else on this
   list matters if we're in state (2).
2. **Fill in `SAME_AS`** in `lib/seo/json-ld.ts` once brand social
   profiles exist. `sameAs` is one of the strongest entity-reconciliation
   signals available — it's how a search engine confirms we're distinct
   from the other four. Deliberately left empty rather than guessed: a
   `sameAs` pointing at a profile we don't control is worse than none.
3. **Backlinks.** The uncomfortable one. A domain with no inbound links
   struggles to get crawled at all, let alone rank. No amount of on-page
   work substitutes.

**Code follow-ups, none blocking:**

- `/collections/[slug]` has no metadata. Needs a `React.cache`'d loader
  first to avoid the `generateMetadata` + page-body double-fetch that
  MTR-53 fixed for files/projects.
- `/u/[username]` and several other public routes still have no metadata
  (see the audit list in PR #190).
- No `BreadcrumbList` JSON-LD anywhere. Would earn breadcrumb trails in
  SERPs for listing pages.
- The home `<h1>` states the offer but not the brand; the brand lives in
  the header `<Logomark />`. If navigational queries underperform, the
  h1 is the lever to revisit.

## Tracking

No Linear issue exists for any of this: the workspace was at its
free-plan issue cap (`You've exceeded the free issue limit for this
workspace`) when the work was done, so `save_issue` rejected the create.
If that cap gets lifted, this doc and PR #190's body have everything
needed to backfill one into **Marketplace: Listings, Purchases &
Disputes**.
