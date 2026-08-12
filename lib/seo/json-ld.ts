/**
 * JSON-LD builders for the public listing pages. Centralized here so
 * the shapes stay consistent across files / projects / profiles —
 * Google's Rich Results validator gets quite cranky about subtle
 * differences in how the same `Person` is represented across pages.
 *
 * Each builder returns a plain object; the consuming page serializes
 * it into a `<script type="application/ld+json">` tag.
 */

// Same fallback ladder as the rest of the app — NEXT_PUBLIC_APP_URL in
// production, materialize.cc as the public fallback so local dev
// doesn't poison the URLs.
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://materialize.cc";

function abs(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Serializes a JSON-LD object for safe embedding inside a
 * `<script type="application/ld+json">` tag via `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` alone does not escape `<`, so a user-authored string
 * field (file/project name or description, profile bio, …) containing
 * `</script><script>…` breaks out of the JSON-LD block into executable
 * HTML — stored XSS against every visitor of the page. We also escape
 * U+2028/U+2029 (line/paragraph separators), which are valid in JSON
 * strings but invalid in JS string literals and can otherwise break
 * some parsers.
 */
// Built via String.fromCharCode rather than literal characters in a
// RegExp source string -- a raw U+2028/U+2029 inside a `/.../ ` regex
// literal is treated by some toolchains (esbuild included) as an actual
// line terminator, which breaks the regex literal itself at parse time.
const LINE_SEPARATOR_RE = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR_RE = new RegExp(String.fromCharCode(0x2029), "g");

export function safeJsonLdScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR_RE, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR_RE, "\\u2029");
}

/**
 * Site-level entity nodes (Organization + WebSite).
 *
 * These exist to solve a specific problem: "Materialize" collides with
 * at least four established entities that already own the SERP —
 * Materialise NV / i.materialise (a Belgian 3D-printing company that
 * also runs a print marketplace, so the collision is topical as well as
 * lexical), Materialize the streaming database, and the MaterializeCSS
 * framework. Without an Organization node there is nothing for a search
 * engine to hang *this* brand on, and every signal we emit gets
 * absorbed into one of theirs.
 *
 * `@id` is a fragment URI on the origin rather than the bare origin, so
 * page-level nodes can reference the org via `{"@id": …/#organization}`
 * without colliding with the WebSite node's identity.
 */

const ORGANIZATION_ID = `${APP_URL}/#organization`;
const WEBSITE_ID = `${APP_URL}/#website`;

/**
 * Verified brand profiles. `sameAs` is one of the strongest entity-
 * reconciliation signals available — it is how a search engine confirms
 * that the Materialize on this domain is a distinct entity from the
 * other four. Deliberately empty rather than guessed: a `sameAs`
 * pointing at a profile we don't control is worse than none. Fill this
 * in as brand accounts are created.
 */
const SAME_AS: string[] = [];

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "Materialize",
    url: APP_URL,
    logo: {
      "@type": "ImageObject",
      url: abs("/icon.svg"),
    },
    description:
      "Materialize is an online marketplace for 3D-print files with on-demand 3D printing built in. Buy and sell STL, OBJ, 3MF and STEP models, or upload any model and have it printed in PLA, resin, nylon or metal and shipped to your door.",
    // Explicitly tells a search engine how this entity differs from the
    // similarly-named ones it already knows about.
    disambiguatingDescription:
      "A 3D-print file marketplace and on-demand printing service at materialize.cc. Not affiliated with Materialise NV / i.materialise, the Materialize streaming database, or the Materialize CSS framework.",
    ...(SAME_AS.length > 0 ? { sameAs: SAME_AS } : {}),
  };
}

/**
 * The WebSite node, including the `SearchAction` that makes this site
 * eligible for a sitelinks search box. The target is the marketplace
 * browse page, whose `q` search param is the site's real full-text
 * search (`app/(app)/files/page.tsx` § searchParams.q).
 */
export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "Materialize",
    url: APP_URL,
    description:
      "Marketplace for 3D-print files with on-demand printing — browse and buy designs, or get any model printed and shipped.",
    publisher: { "@id": ORGANIZATION_ID },
    inLanguage: "en-US",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${APP_URL}/files?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export type FaqEntry = { question: string; answer: string };

/**
 * FAQPage markup. Google requires every marked-up answer to be visibly
 * present on the page, so callers must build this from the same source
 * the visible FAQ renders from — see `lib/seo/home-faq.ts`, which is
 * the single source both consume.
 */
export function faqPageJsonLd(entries: readonly FaqEntry[], pageUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${abs(pageUrl)}#faq`,
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: e.answer,
      },
    })),
  };
}

type PersonInput = {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio?: string | null;
};

/**
 * The author / profile-subject Person object. Used both as a top-level
 * `@type: "Person"` on the profile page and as the `author` slot in
 * the file / project schemas. `@id` is the canonical profile URL so
 * Google can reconcile the same person across pages.
 */
export function personJsonLd(person: PersonInput) {
  const profileUrl = person.username ? abs(`/${person.username}`) : undefined;
  return {
    "@type": "Person",
    ...(profileUrl ? { "@id": profileUrl } : {}),
    name: person.displayName || person.username || "Materialize creator",
    ...(person.username ? { alternateName: person.username } : {}),
    ...(person.avatarUrl ? { image: person.avatarUrl } : {}),
    ...(profileUrl ? { url: profileUrl } : {}),
    ...(person.bio ? { description: person.bio } : {}),
  };
}

export function profilePageJsonLd(person: PersonInput) {
  if (!person.username) return null;
  const profileUrl = abs(`/${person.username}`);
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: profileUrl,
    mainEntity: personJsonLd(person),
  };
}

type FileInput = {
  slug: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  license: string | null;
  price: number; // cents, 0 = free
  createdAt: Date | string;
  author: PersonInput;
};

/**
 * Files are 3D-printable models — `3DModel` is the schema.org type
 * that fits closest. We pair it with an `Offer` for sellable files so
 * search engines surface price/availability the same way they do for
 * the materials catalog.
 */
export function fileJsonLd(file: FileInput) {
  const fileUrl = abs(`/files/${file.slug}`);
  const priceUsd = (file.price / 100).toFixed(2);
  return {
    "@context": "https://schema.org",
    "@type": "3DModel",
    "@id": fileUrl,
    name: file.name,
    ...(file.description ? { description: file.description } : {}),
    url: fileUrl,
    ...(file.thumbnailUrl ? { image: abs(file.thumbnailUrl) } : {}),
    encodingFormat: "model/stl",
    isAccessibleForFree: file.price === 0,
    ...(file.license ? { license: file.license } : {}),
    dateCreated:
      file.createdAt instanceof Date
        ? file.createdAt.toISOString()
        : file.createdAt,
    creator: personJsonLd(file.author),
    author: personJsonLd(file.author),
    offers: {
      "@type": "Offer",
      url: fileUrl,
      price: priceUsd,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

type ProjectInput = {
  slug: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  license: string | null;
  price: number;
  createdAt: Date | string;
  author: PersonInput;
  /** Optional list of bundled file slugs for `hasPart`. */
  fileSlugs?: string[];
};

/**
 * Projects bundle N printable files plus optional BOM + wiring. The
 * cleanest schema.org match is `CreativeWork` with each bundled file
 * referenced via `hasPart` → another `3DModel`. We also surface the
 * Offer for the bundle as a whole.
 */
export function projectJsonLd(project: ProjectInput) {
  const projectUrl = abs(`/projects/${project.slug}`);
  const priceUsd = (project.price / 100).toFixed(2);
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": projectUrl,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    url: projectUrl,
    ...(project.thumbnailUrl ? { image: abs(project.thumbnailUrl) } : {}),
    isAccessibleForFree: project.price === 0,
    ...(project.license ? { license: project.license } : {}),
    dateCreated:
      project.createdAt instanceof Date
        ? project.createdAt.toISOString()
        : project.createdAt,
    creator: personJsonLd(project.author),
    author: personJsonLd(project.author),
    ...(project.fileSlugs && project.fileSlugs.length > 0
      ? {
          hasPart: project.fileSlugs.map((slug) => ({
            "@type": "3DModel",
            "@id": abs(`/files/${slug}`),
            url: abs(`/files/${slug}`),
          })),
        }
      : {}),
    offers: {
      "@type": "Offer",
      url: projectUrl,
      price: priceUsd,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}
