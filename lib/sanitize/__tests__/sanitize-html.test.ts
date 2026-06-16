import { describe, it, expect } from "vitest";
import { sanitizeRichHtml } from "../sanitize-html";

describe("sanitizeRichHtml", () => {
  it("strips <script> tags", async () => {
    const out = await sanitizeRichHtml(
      "<p>hi</p><script>alert(1)</script>"
    );
    expect(out).toContain("<p>hi</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips inline event handlers", async () => {
    const out = await sanitizeRichHtml(
      '<img src="/api/thumbnails/projects/x?photoId=y" onerror="alert(1)">'
    );
    expect(out).not.toContain("onerror");
    expect(out).toContain("/api/thumbnails/projects/x?photoId=y");
  });

  it("drops javascript: links", async () => {
    const out = await sanitizeRichHtml(
      '<a href="javascript:alert(1)">x</a>'
    );
    expect(out).not.toContain("javascript:");
  });

  it("keeps allowed formatting tags", async () => {
    const html =
      "<h2>Step 1</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>one</li></ul>";
    const out = await sanitizeRichHtml(html);
    expect(out).toContain("<h2>Step 1</h2>");
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<li>one</li>");
  });

  it("preserves the extended img sizing and align attributes", async () => {
    const out = await sanitizeRichHtml(
      '<p align="center"><img src="/img.png" width="200" loading="lazy"></p>'
    );
    expect(out).toContain('align="center"');
    expect(out).toContain('width="200"');
    expect(out).toContain('loading="lazy"');
  });

  it("keeps a safe external link", async () => {
    const out = await sanitizeRichHtml(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener">x</a>'
    );
    expect(out).toContain('href="https://example.com"');
  });
});
