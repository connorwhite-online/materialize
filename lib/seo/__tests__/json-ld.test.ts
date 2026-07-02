import { describe, it, expect } from "vitest";
import {
  safeJsonLdScript,
  fileJsonLd,
  projectJsonLd,
  personJsonLd,
} from "../json-ld";

describe("safeJsonLdScript", () => {
  it("escapes </script> so it can never terminate the surrounding script tag", () => {
    const html = safeJsonLdScript({ description: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script>");
    expect(html).toContain("\\u003c/script>");
  });

  it("escapes any stray < character, not just </script>", () => {
    const html = safeJsonLdScript({ name: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<");
    expect(html).toContain("\\u003cimg");
  });

  it("escapes U+2028 and U+2029 line/paragraph separators", () => {
    const html = safeJsonLdScript({ name: "line one line two line three" });
    expect(html).not.toContain(" ");
    expect(html).not.toContain(" ");
    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
  });

  it("still produces valid JSON once unescaped back through JS string parsing", () => {
    const original = { a: "<b>", c: 1, d: ["</script>", "e"] };
    const html = safeJsonLdScript(original);
    // The escaped output is valid inside a JS string literal / JSON parser:
    // < round-trips back to "<" when JSON-parsed.
    const parsed = JSON.parse(html);
    expect(parsed).toEqual(original);
  });

  it("never leaves an unescaped </script> in the rendered output of a real fileJsonLd payload with a hostile name/description", () => {
    const hostile = fileJsonLd({
      slug: "hostile-slug",
      name: '</script><script>alert("xss")</script>',
      description: '</script><script>alert("xss2")</script>',
      thumbnailUrl: null,
      license: null,
      price: 0,
      createdAt: new Date("2026-01-01"),
      author: {
        username: "attacker",
        displayName: '</script><script>alert("author")</script>',
        avatarUrl: null,
      },
    });
    const html = safeJsonLdScript(hostile);
    expect(html).not.toContain("</script>");
  });

  it("never leaves an unescaped </script> in the rendered output of a real projectJsonLd payload with a hostile name/description", () => {
    const hostile = projectJsonLd({
      slug: "hostile-project",
      name: '</script><script>alert("xss")</script>',
      description: '</script><script>alert("xss2")</script>',
      thumbnailUrl: null,
      license: null,
      price: 0,
      createdAt: new Date("2026-01-01"),
      author: {
        username: "attacker",
        displayName: null,
        avatarUrl: null,
      },
    });
    const html = safeJsonLdScript(hostile);
    expect(html).not.toContain("</script>");
  });

  it("never leaves an unescaped </script> in a hostile bio via personJsonLd", () => {
    const hostile = personJsonLd({
      username: "attacker",
      displayName: "Attacker",
      avatarUrl: null,
      bio: '</script><script>alert("bio")</script>',
    });
    const html = safeJsonLdScript(hostile);
    expect(html).not.toContain("</script>");
  });
});
