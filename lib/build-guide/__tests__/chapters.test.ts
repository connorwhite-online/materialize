import { describe, it, expect } from "vitest";
import { splitGuideIntoChapters } from "../chapters";

describe("splitGuideIntoChapters", () => {
  it("returns the whole doc as intro when there are no H2s", () => {
    const { intro, chapters } = splitGuideIntoChapters("<p>just a paragraph</p>");
    expect(chapters).toHaveLength(0);
    expect(intro).toBe("<p>just a paragraph</p>");
  });

  it("treats legacy markdown (no <h2>) as a single intro block", () => {
    const md = "## Heading\n\nsome **markdown**";
    const { intro, chapters } = splitGuideIntoChapters(md);
    expect(chapters).toHaveLength(0);
    expect(intro).toBe(md);
  });

  it("splits content before the first H2 into the intro", () => {
    const html = "<p>preamble</p><h2>One</h2><p>body</p>";
    const { intro, chapters } = splitGuideIntoChapters(html);
    expect(intro).toBe("<p>preamble</p>");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("One");
    expect(chapters[0].bodyHtml).toBe("<p>body</p>");
  });

  it("splits multiple chapters on H2 boundaries", () => {
    const html =
      "<h2>First</h2><p>a</p><p>b</p><h2>Second</h2><ul><li>c</li></ul>";
    const { intro, chapters } = splitGuideIntoChapters(html);
    expect(intro).toBe("");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe("First");
    expect(chapters[0].bodyHtml).toBe("<p>a</p><p>b</p>");
    expect(chapters[1].title).toBe("Second");
    expect(chapters[1].bodyHtml).toBe("<ul><li>c</li></ul>");
  });

  it("strips inline tags out of the chapter title", () => {
    const { chapters } = splitGuideIntoChapters(
      "<h2><strong>Bold</strong> title</h2><p>x</p>"
    );
    expect(chapters[0].title).toBe("Bold title");
  });

  it("produces unique, slugged ids per chapter", () => {
    const { chapters } = splitGuideIntoChapters(
      "<h2>Same</h2><p>x</p><h2>Same</h2><p>y</p>"
    );
    expect(chapters[0].id).not.toBe(chapters[1].id);
    expect(chapters[0].id).toContain("same");
  });
});
