// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownProse } from "../markdown-prose";

// The build guide imports formatted HTML (pasted from external CMSes),
// e.g. `<h1 align="center">…</h1>`, `<br>`, `<img src="…">`. With
// `allowHtml` that markup must render rather than show as escaped text,
// while still being scrubbed of script injection.
describe("MarkdownProse allowHtml", () => {
  it("renders embedded HTML when allowHtml is set", () => {
    const { container } = render(
      <MarkdownProse allowHtml>
        {'<h1 align="center">TERRA</h1>\n\n<img src="https://example.com/a.png" alt="device" />'}
      </MarkdownProse>
    );
    // h1 is remapped to a styled h2 by the component overrides.
    expect(container.querySelector("h2")?.textContent).toContain("TERRA");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/a.png"
    );
  });

  it("strips scripts even with allowHtml", () => {
    const { container } = render(
      <MarkdownProse allowHtml>
        {'<p>safe</p><script>window.__pwned = 1</script>'}
      </MarkdownProse>
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("safe");
  });

  it("does not render raw HTML when allowHtml is off", () => {
    const { container } = render(
      <MarkdownProse>{"<h1>plain</h1>"}</MarkdownProse>
    );
    // Without allowHtml the markup is inert text, not a heading element.
    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).toContain("<h1>plain</h1>");
  });
});
