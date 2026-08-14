import { describe, it, expect } from "vitest";
import {
  organizationJsonLd,
  webSiteJsonLd,
  faqPageJsonLd,
  safeJsonLdScript,
} from "../json-ld";
import { HOME_FAQ } from "../home-faq";

/**
 * The site-level entity nodes exist to separate this brand from the
 * several established "Materialize"/"Materialise" entities that already
 * rank for everything we want. These tests pin the properties that do
 * that work, so a future edit can't quietly drop them.
 */

describe("organizationJsonLd", () => {
  it("is a schema.org Organization with a stable fragment @id", () => {
    const org = organizationJsonLd();
    expect(org["@context"]).toBe("https://schema.org");
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toMatch(/#organization$/);
  });

  it("carries a disambiguatingDescription naming the colliding entities", () => {
    const org = organizationJsonLd();
    // The whole point of the node. If someone trims this to "clean up
    // the copy", the entity-separation signal goes with it.
    expect(org.disambiguatingDescription).toMatch(/not affiliated/i);
    expect(org.disambiguatingDescription).toMatch(/Materialise NV/);
  });

  it("says what the company does in the description", () => {
    expect(organizationJsonLd().description).toMatch(/3D[- ]print/i);
  });

  it("omits sameAs entirely rather than emitting an empty array", () => {
    // An empty `sameAs: []` is a malformed signal; absent is correct
    // until real brand profiles exist to point at.
    const org = organizationJsonLd();
    expect("sameAs" in org ? org.sameAs : undefined).not.toEqual([]);
  });
});

describe("webSiteJsonLd", () => {
  it("is a WebSite published by the Organization node", () => {
    const site = webSiteJsonLd();
    expect(site["@type"]).toBe("WebSite");
    expect(site.publisher["@id"]).toBe(organizationJsonLd()["@id"]);
  });

  it("declares a SearchAction pointing at the real browse query param", () => {
    const action = webSiteJsonLd().potentialAction;
    expect(action["@type"]).toBe("SearchAction");
    // `/files` reads `searchParams.q` — if that param is ever renamed,
    // the sitelinks search box would silently 404 users.
    expect(action.target.urlTemplate).toContain("/files?q={search_term_string}");
    expect(action["query-input"]).toBe("required name=search_term_string");
  });

  it("uses a different @id from the Organization node", () => {
    expect(webSiteJsonLd()["@id"]).not.toBe(organizationJsonLd()["@id"]);
  });
});

describe("faqPageJsonLd", () => {
  it("maps every entry to a Question with an accepted Answer", () => {
    const faq = faqPageJsonLd(HOME_FAQ, "/");
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(HOME_FAQ.length);
    for (const [i, node] of faq.mainEntity.entries()) {
      expect(node["@type"]).toBe("Question");
      expect(node.name).toBe(HOME_FAQ[i].question);
      expect(node.acceptedAnswer["@type"]).toBe("Answer");
      expect(node.acceptedAnswer.text).toBe(HOME_FAQ[i].answer);
    }
  });

  it("anchors @id to an absolute URL for the page it lives on", () => {
    expect(faqPageJsonLd(HOME_FAQ, "/")["@id"]).toMatch(/^https?:\/\/.+#faq$/);
  });

  it("survives the script escaper without corrupting the answer text", () => {
    const html = safeJsonLdScript(faqPageJsonLd(HOME_FAQ, "/"));
    expect(html).not.toContain("<");
    const parsed = JSON.parse(html.replace(/\\u003c/g, "<"));
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe(HOME_FAQ[0].answer);
  });
});

describe("HOME_FAQ content", () => {
  it("answers the brand-collision question explicitly, last", () => {
    // Still the highest-value disambiguation, but it sits at the
    // bottom so product questions lead. Someone who lands here
    // wondering whether this is the Belgian company still gets a
    // direct answer, and so does an answer engine summarizing the page.
    const entry = HOME_FAQ.at(-1);
    expect(entry?.question).toMatch(/Materialise|i\.materialise/);
    expect(entry?.answer).toMatch(/^No\./);
  });

  it("has unique questions", () => {
    const seen = new Set(HOME_FAQ.map((f) => f.question));
    expect(seen.size).toBe(HOME_FAQ.length);
  });

  it("keeps answers plain text so the DOM matches acceptedAnswer.text byte for byte", () => {
    // <HomeFaq /> renders each answer as a bare string child. Markup or
    // markdown here would render literally on the page and break the
    // "marked-up answer must be visible" requirement.
    for (const { answer } of HOME_FAQ) {
      expect(answer).not.toMatch(/[<>]|\*\*|\[.+\]\(/);
      expect(answer.trim()).toBe(answer);
      expect(answer.length).toBeGreaterThan(40);
    }
  });
});
